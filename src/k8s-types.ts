interface IngressBackend {
  resource?: {
    apiGroup?: string
    kind: string
    name: string
  }
  service?: {
    name: string
    port?: {
      name?: string
      number?: number
    }
  }
}

export interface IngressApiObject {
  apiVersion: "networking.k8s.io/v1"
  kind: "Ingress"
  metadata: {
    uid: string
    namespace: string
    name: string
  }
  spec: {
    defaultBackend?: IngressBackend
    ingressClassName?: string
    rules?: {
      host?: string
      http?: {
        paths: {
          backend: IngressBackend
          path?: string
          pathType: string
        }[]
      }
    }[]
    tls?: {
      hosts: string[]
      secretName: string
    }[]
  }
}

export interface IngressRouteApiObject {
  apiVersion: "traefik.containo.us/v1alpha1"
  kind: "IngressRoute"
  metadata: {
    uid: string
    namespace: string
    name: string
  }
  spec: {
    entryPoints?: string[]
    routes: {
      kind: string
      match: string
      middlewares?: {
        name: string
        namespace?: string
      }[]
      priority?: number
      services?: {
        kind?: string
        name: string
        namespace?: string
        nativeLB?: boolean
        passHostHeader?: boolean
        port?: number | unknown
        responseForwarding?: {
          flushInterval?: string
        }
        scheme?: string
        serversTransport?: string
        sticky?: {
          cookie?: {
            httpOnly?: boolean
            name?: string
            sameSite?: string
            secure?: boolean
          }
        }
        strategy?: string
        weight?: number
      }[]
    }[]
    tls?: {
      certResolver?: string
      domains?: {
        main: string
        sans: string[]
      }[]
      options?: {
        name: string
        namespace?: string
      }
      secretName?: string
      store?: {
        name: string
        namespace: string
      }
    }
  }
}
