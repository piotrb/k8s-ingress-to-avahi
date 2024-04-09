import { KubeConfig, Watch } from "@kubernetes/client-node"
import { AvahiEntryGroupInterface, avahiAddAlias, avahiDeleteAlias, cleanup as cleanupAvahi } from "./avahi.mjs";
import { removeItem } from "./util.mjs";

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

export class IngresTracker {
  cnames: Record<string, AvahiEntryGroupInterface> = {}
  entriesByUid: Record<string, Record<string, boolean>> = {}

  constructor(private hostname: string, private kc: KubeConfig, private namespace: string) {
  }

  async run() {
    const watch = new Watch(this.kc);

    const waitReq = await watch.watch(`/apis/networking.k8s.io/v1/namespaces/${this.namespace}/ingresses`, {}, async (phase, apiObj) => {
      // console.info(phase, apiObj)
      console.info(`${phase} - ${apiObj.metadata.namespace}/${apiObj.metadata.name}`)

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
          console.error("got unhandled event", phase, apiObj)
      }
    }, (err) => {
      console.info("done", err)
      this.cleanup()
    })

    process.on('SIGTERM', () => waitReq.abort())
    process.on('SIGINT', () => waitReq.abort())
  }

  async cleanup() {
    for (const k in this.cnames) {
      await this.cnames[k].Reset()
      await this.cnames[k].Free()
    }
    cleanupAvahi()
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
    if (!this.cnames[host]) {
      console.info("Adding", host)

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
    if (this.cnames[host]) {
      console.info("Deleting", host)
      await avahiDeleteAlias(this.cnames[host])
      delete this.cnames[host]
    }
  }
}
