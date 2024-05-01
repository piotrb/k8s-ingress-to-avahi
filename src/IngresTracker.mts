import { KubeConfig, Watch } from "@kubernetes/client-node"
import { AvahiEntryGroupInterface, avahiAddAlias, avahiDeleteAlias, cleanup as cleanupAvahi } from "./avahi.mjs";
import { removeItem } from "./util.mjs";
import { BaseLogger } from "pino";
import { IngressApiObject, IngressRouteApiObject } from "./k8s-types.js";

interface ConstructorOptions {
  hostname: string
  kc: KubeConfig
  logger: BaseLogger
}

type SupportedApiObject = IngressApiObject | IngressRouteApiObject

export class IngresTracker {
  cnames: Record<string, AvahiEntryGroupInterface> = {}
  entriesByUid: Record<string, Record<string, boolean>> = {}

  private readonly hostname: string
  private readonly kc: KubeConfig
  private readonly logger: BaseLogger

  constructor(options: ConstructorOptions) {
    this.hostname = options.hostname
    this.kc = options.kc
    this.logger = options.logger
  }

  async watchUrl(name: string, url: string, onData: (phase: string, apiObj: any, watchObj?: any) => Promise<void>) {
    return new Promise<void>(async (resolve, reject) => {
      try {
        const watch = new Watch(this.kc);

        const waitReq = await watch.watch(url, {}, async (phase, apiObj, watchObj) => {
          await onData(phase, apiObj, watchObj)
        }, (err) => {
          if (err !== undefined && err !== null) {
            if (err.type === "aborted") {
              this.logger.info(`${name} - aborted`)
              resolve()
            } else {
              this.logger.error(`${name} - done with errors`)
              reject(err)
            }
          } else {
            this.logger.info(`${name} - done`)
            resolve()
          }
        })

        process.on('SIGTERM', () => waitReq.abort("SIGTERM"))
        process.on('SIGINT', () => waitReq.abort("SIGINT"))
      } catch (e) {
        reject(e)
      }
    })
  }

  async onData(phase: string, apiObj: SupportedApiObject) {
    this.logger.info({ kind: apiObj.kind, phase, ingress: { namespace: apiObj.metadata.namespace, name: apiObj.metadata.name } }, `Got ${apiObj.kind}: ${phase} - ${apiObj.metadata.namespace}/${apiObj.metadata.name}`)

    switch (phase) {
      case "ADDED":
        await this.handleAdded(apiObj)
        break;
      case "DELETED":
        await this.handleDeleted(apiObj)
        break;
      case "MODIFIED":
        await this.handleModified(apiObj)
        break;
      default:
        this.logger.error({ phase, apiObj }, "got unhandled event")
    }
  }

  getHostsFromIngressRules(rules: IngressApiObject["spec"]["rules"]): string[] {
    const results: string[] = []
    if (rules) {
      for (const rule of rules) {
        if (rule.host) {
          results.push(rule.host)
        }
      }
    }
    return results
  }

  getHostsFromIngressRouteMatch(match: string): string[] {
    // eg: Host(`argocd.local`)
    const results: string[] = []
    for (const matched of match.matchAll(/Host\(`([^`]+)`\)/g)) {
      results.push(matched[1])
    }
    return results
  }

  getHostsFromObject(object: SupportedApiObject): string[] {
    const results: string[] = []
    switch (object.kind) {
      case "Ingress":
        results.push(...this.getHostsFromIngressRules(object.spec.rules))
        break
      case "IngressRoute":
        for (const route of object.spec.routes) {
          results.push(...this.getHostsFromIngressRouteMatch(route.match))
        }
        break
      default:
        throw new Error(`don't know how to handle kind: ${(object as any).kind}`)
    }
    return results
  }

  async run() {
    try {
      return Promise.all([
        this.watchUrl("ingresses", "/apis/networking.k8s.io/v1/ingresses", (phase, apiObj) => this.onData(phase, apiObj)),
        this.watchUrl("ingressroutes", "/apis/traefik.containo.us/v1alpha1/ingressroutes", (phase, apiObj) => this.onData(phase, apiObj)),
      ])
    } catch (e) {
      this.cleanup()
      throw e
    }
  }

  async cleanup() {
    for (const k in this.cnames) {
      await this.cnames[k].Reset()
      await this.cnames[k].Free()
    }
    cleanupAvahi()
  }

  validHostname(hostname: string): boolean {
    return hostname.endsWith(".local")
  }

  async handleAdded(apiObj: SupportedApiObject) {
    const hosts = this.getHostsFromObject(apiObj)
    for (const host of hosts) {
      await this.addAlias(host, apiObj.metadata.uid)
    }
  }

  async handleDeleted(apiObj: SupportedApiObject) {
    const hosts = this.getHostsFromObject(apiObj)
    for (const host of hosts) {
      await this.deleteAlias(host)
    }
    delete this.entriesByUid[apiObj.metadata.uid]
  }

  async handleModified(apiObj: SupportedApiObject) {
    let originalHostnames = Object.keys(this.entriesByUid[apiObj.metadata.uid])
    const newHostnames = this.getHostsFromObject(apiObj)

    for (const host in newHostnames) {
      removeItem(originalHostnames, host)
      if (!this.entriesByUid[apiObj.metadata.uid][host]) {
        await this.addAlias(host, apiObj.metadata.uid)
      }
    }

    for (const host of originalHostnames) {
      await this.deleteAlias(host)
    }
  }

  async addAlias(host: string, uid: string) {
    if (!this.validHostname(host)) {
      this.logger.debug({ host }, `Skipping ${host} because its not .local`)
      return
    }

    if (!this.cnames[host]) {
      this.logger.info({ host }, `Adding ${host}`)

      const entryGroupInt = await avahiAddAlias(host, this.hostname)

      this.cnames[host] = entryGroupInt
      if (!this.entriesByUid[uid]) {
        this.entriesByUid[uid] = {}
      }
      if (!this.entriesByUid[uid][host]) {
        this.entriesByUid[uid][host] = true
      }
    }
  }

  async deleteAlias(host: string) {
    if (!this.validHostname(host)) {
      this.logger.debug({ host }, `Skipping ${host} because its not .local`)
      return
    }

    if (this.cnames[host]) {
      this.logger.info({ host }, `Deleting ${host}`)
      await avahiDeleteAlias(this.cnames[host])
      delete this.cnames[host]
    }
  }
}
