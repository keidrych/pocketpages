import { forEach, merge } from '@s-libs/micro-dash'
import type { SerializeOptions } from 'cookie'
import * as cookie from 'cookie'
import { error } from 'pocketbase-log'
import { stringify } from 'pocketbase-stringify'
import { fingerprint as applyFingerprint } from 'src/lib/fingerprint'
import { globalApi } from 'src/lib/globalApi'
import { default as parse, default as URL } from 'url-parse'
import { dbg } from '../lib/debug'
import { echo, mkMeta, mkResolve, pagesRoot } from '../lib/helpers'
import { loadPlugins } from '../lib/loadPlugins'
import { resolveRoute } from '../lib/resolveRoute'
import {
  Cache,
  PagesMethods,
  PagesMiddlewareFunc,
  PagesNextFunc,
  PagesRequest,
  PagesRequestContext,
  PagesResponse,
  Plugin,
  RedirectOptions,
} from '../lib/types'

export const parseSlots = (input: string) => {
  const regex = /<!--\s*slot:(\w+)\s*-->([\s\S]*?)(?=<!--\s*slot:\w+\s*-->|$)/g
  const slots: Record<string, string> = {}
  let lastIndex = 0
  let cleanedContent = ''
  let match: RegExpExecArray | null

  while ((match = regex.exec(input)) !== null) {
    const name = match[1]
    const content = match[2]?.trim()
    if (name && content) {
      slots[name] = content
      // Add the content between the last match and this slot tag
      cleanedContent += input.slice(lastIndex, match.index)
      lastIndex = match.index + match[0].length
    }
  }
  // Add any remaining content after the last slot
  cleanedContent += input.slice(lastIndex)

  return {
    slots,
    content: cleanedContent.trim(),
  }
}

const jsonResponder: Plugin = {
  /**
   * Attempt to parse the content as JSON
   */
  onResponse: ({ content, api, route }) => {
    const { response } = api
    try {
      dbg(`Attempting to parse as JSON`)
      const parsed = JSON.parse(content)
      response.json(200, parsed)
      return true
    } catch (e) {
      dbg(`Not JSON`)
    }
    return false
  },
}

const defaultResponder: Plugin = {
  onResponse: ({ content, api, route }) => {
    const { response } = api
    response.html(200, content)
    return true
  },
}

export const MiddlewareHandler: PagesMiddlewareFunc = (e) => {
  const next: PagesNextFunc = () => {
    e.next()
  }
  if (!e.request) {
    dbg(`No request, passing on to PocketBase`)
    return next()
  }

  const { method, url } = e.request

  dbg({ method, url })

  if (!url) {
    dbg(`No URL, passing on to PocketBase`)
    return next()
  }

  dbg(`Pages middleware request: ${method} ${url}`)

  const request: PagesRequest = {
    auth: e.auth,
    method: method.toUpperCase() as PagesMethods,
    url: parse(url.string()),
    formData: () => e.requestInfo().body,
    body: () => e.requestInfo().body,
    header: (name: string) => {
      return e.request?.header.get(name) || ''
    },
    cookies: (() => {
      let parsed: Record<string, any>

      const tryParseJson = (value: string | undefined) => {
        if (!value) return value
        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      }

      const cookieFunc = <T = Record<string, any>>(name?: string): T => {
        if (!parsed) {
          const cookieHeader = request.header('Cookie')
          const rawParsed = cookie.parse(cookieHeader || '')
          // Parse all values once during initialization
          parsed = Object.fromEntries(
            Object.entries(rawParsed).map(([key, value]) => [
              key,
              tryParseJson(value),
            ])
          )
        }

        if (name === undefined) {
          return parsed as T
        }
        return parsed[name] as T
      }

      return cookieFunc as {
        <T = Record<string, any>>(): T
        <T>(name: string): T
      }
    })(),
  }

  const response: PagesResponse = {
    file: (path: string) => {
      return e.fileFS($os.dirFS($filepath.dir(path)), $filepath.base(path))
    },
    write: (s: string) => {
      e.response.write(s)
    },
    redirect: (path: string, status = 302) => {
      e.redirect(status, path)
    },
    json: (status: number, data: any) => {
      e.json(status, data)
    },
    html: (status: number, data: string) => {
      e.html(status, data)
    },
    header: (name: string, value?: string) => {
      if (value === undefined) {
        return e.response.header().get(name) || ''
      }
      e.response.header().set(name, value)
      return value
    },
    cookie: <T>(
      name: string,
      value: T,
      options: Partial<SerializeOptions> = {}
    ) => {
      const _options = {
        path: '/',
        ...options,
      }
      const stringifiedValue = (() => {
        if (typeof value !== 'string') {
          return stringify(value)
        }
        return value
      })()
      const serialized = cookie.serialize(name, stringifiedValue, _options)
      response.header(`Set-Cookie`, serialized)
      return serialized
    },
  }

  const cache = $app.store<Cache>().get(`pocketpages`)
  const { routes, config } = cache

  const plugins = loadPlugins(cache)
  plugins.forEach((plugin) => plugin.onRequest?.({ request, response }))

  const resolvedRoute = resolveRoute(request.url, routes)

  /**
   * If it doesn't match any known route, pass it on
   */
  if (!resolvedRoute) {
    // Otherwise, pass it on to PocketBase to handle
    dbg(`No route matched for ${url}, passing on to PocketBase`)
    return next()
  }

  const { route, params } = resolvedRoute
  const { absolutePath, relativePath } = route

  try {
    /**
     * If the file exists but no plugin handles it, serve statically
     */
    if (route.isStatic) {
      dbg(`Serving static file ${absolutePath}`)
      return response.file(absolutePath)
    }

    /*
    At this point, we have a route PocketPages needs to handle.
    */
    dbg(`Found a matching route`, { resolvedRoute })

    const api: PagesRequestContext<any> = {
      ...globalApi,
      params,
      echo: (...args) => {
        const s = echo(...args)
        response.write(s)
        return s
      },
      formData: request.formData,
      body: request.body,
      auth: request.auth,
      request,
      response,
      redirect: (path, _options) => {
        const options: RedirectOptions = {
          status: 302,
          message: '',
          ..._options,
        }
        const parsed = globalApi.url(path)
        parsed.query.__flash = options.message
        response.redirect(parsed.toString(), options.status)
      },
      slot: '',
      slots: {},
      asset: (path) => {
        const shortAssetPath = path.startsWith('/')
          ? path
          : $filepath.join(route.assetPrefix, path)
        const fullAssetPath = path.startsWith('/')
          ? path
          : $filepath.join(
              ...route.segments.slice(0, -2).map((s) => s.nodeName),
              route.assetPrefix,
              path
            )
        const assetRoute = resolveRoute(new URL(fullAssetPath), routes)
        dbg({ fullAssetPath, shortAssetPath, assetRoute })
        if (!assetRoute) {
          return `${shortAssetPath}`
        }
        return applyFingerprint(shortAssetPath, assetRoute.route.fingerprint)
      },
      meta: mkMeta(),
      resolve: mkResolve($filepath.dir(absolutePath)),
    }

    plugins.forEach((plugin) => plugin.onExtendContextApi?.({ api, route }))

    let data = {}
    route.middlewares.forEach((maybeMiddleware) => {
      dbg(`Executing middleware ${maybeMiddleware}`)
      data = merge(data, require(maybeMiddleware)({ ...api, data }))
    })

    // Execute loaders
    {
      const methods = ['load', method.toLowerCase(), method]
      forEach(methods, (method) => {
        const loaderFname = route.loaders[method as keyof typeof route.loaders]
        if (!loaderFname) return
        dbg(`Executing loader ${loaderFname}`)
        data = merge(data, require(loaderFname)({ ...api, data }))
      })
    }

    api.data = data
    dbg(`Final api:`, { params: api.params, data: api.data })

    //@ts-ignore
    delete api.echo

    let content = plugins.reduce((content, plugin) => {
      return (
        plugin.onRender?.({
          content,
          api,
          route,
          filePath: absolutePath,
          plugins,
        }) ?? content
      )
    }, '')

    /**
     * Render the content in the layout
     */
    route.layouts.forEach((layoutPath) => {
      const res = parseSlots(content)
      api.slots = res.slots
      api.slot = res.slots.default || res.content
      content = plugins.reduce((content, plugin) => {
        return (
          plugin.onRender?.({
            content,
            api,
            route,
            filePath: layoutPath,
            plugins,
          }) ?? content
        )
      }, content)
    })

    for (const plugin of [...plugins, jsonResponder, defaultResponder]) {
      if (plugin.onResponse?.({ content, api, route })) {
        return
      }
    }
    throw new Error(`No plugin handled the response`)
  } catch (e) {
    error(e)
    const message = (() => {
      const m = `${e}`
      if (m.includes('Value is not an object'))
        return `${m} - are you referencing a symbol missing from require() or resolve()?`
      return `${e}`
    })()
    if (e instanceof BadRequestError) {
      return response.html(400, message)
    }
    return response.html(
      500,
      `<html><body><h1>PocketPages Error</h1><pre><code>${message}\n${
        e instanceof Error
          ? e.stack
              ?.replaceAll(pagesRoot, '/' + $filepath.base(pagesRoot))
              .replaceAll(__hooks, '')
          : ''
      }</code></pre></body></html>`
    )
  }
}
