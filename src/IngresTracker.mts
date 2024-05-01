import { KubeConfig, Watch } from "@kubernetes/client-node"
import { AvahiEntryGroupInterface, avahiAddAlias, avahiDeleteAlias, cleanup as cleanupAvahi } from "./avahi.mjs";
import { removeItem } from "./util.mjs";
import { BaseLogger } from "pino";

interface IngressApiObject {
  metadata: {
    uid: string
  }
  spec: {
    rules?: {
      host: string
    }[]
  }
}

interface ConstructorOptions {
  hostname: string
  kc: KubeConfig
  logger: BaseLogger
}

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

  async run() {
    return new Promise<void>(async (resolve, reject) => {
      try {
        const watch = new Watch(this.kc);

        const url = `/apis/networking.k8s.io/v1/ingresses`

        const waitReq = await watch.watch(url, {}, async (phase, apiObj) => {
          this.logger.info({ phase, ingress: { namespace: apiObj.metadata.namespace, name: apiObj.metadata.name } }, `${phase} - ${apiObj.metadata.namespace}/${apiObj.metadata.name}`)

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
        }, (err) => {
          if (err !== undefined) {
            if (err.type === "aborted") {
              this.logger.info("aborted")
              resolve()
            } else {
              this.cleanup()
              this.logger.error("done with errors")
              reject(err)
            }
          } else {
            this.logger.info("done")
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

  async handleAdded(apiObj: IngressApiObject) {
    if (apiObj.spec.rules) {
      for (const rule of apiObj.spec.rules) {
        const host = rule.host
        await this.addAlias(host, apiObj.metadata.uid)
      }
    }
  }

  async handleDeleted(apiObj: IngressApiObject) {
    if (apiObj.spec.rules) {
      for (const rule of apiObj.spec.rules) {
        const host = rule.host
        await this.deleteAlias(host)
      }
    }
    delete this.entriesByUid[apiObj.metadata.uid]
  }

  async handleModified(apiObj: IngressApiObject) {
    let hostnames = Object.keys(this.entriesByUid[apiObj.metadata.uid])
    if (apiObj.spec.rules) {
      for (const rule of apiObj.spec.rules) {
        const host = rule.host
        hostnames = removeItem(hostnames, host)
        if (!this.entriesByUid[apiObj.metadata.uid][host]) {
          await this.addAlias(host, apiObj.metadata.uid)
        }
      }
    }
    for (const host of hostnames) {
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
