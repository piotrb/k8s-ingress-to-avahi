import { MessageBus, systemBus } from 'dbus-next'
import { EventEmitter } from "events";

let bus: MessageBus | null = null

function getBus(): MessageBus {
  if (bus === null) {
    bus = systemBus()
  }
  return bus
}

export function cleanup() {
  if (bus !== null) {
    bus.disconnect()
  }
}

function encodingLength(n: string) {
  if (n === '.') return 1
  return Buffer.byteLength(n) + 2
}

function encodeFQDN(name: string) {
  let buf = Buffer.allocUnsafe(encodingLength(name))

  let offset = 0
  let parts = name.split('.')
  for (let i = 0; i < parts.length; i++) {
    const length = buf.write(parts[i], offset + 1)
    buf[offset] = length
    offset += length + 1
  }

  buf[offset++] = 0
  return buf
}

export interface AvahiMainInterface extends EventEmitter {
  EntryGroupNew(): string
}

export interface AvahiEntryGroupInterface extends EventEmitter {
  AddRecord(interface_: number, protocol: number, flags: number, name: string, clazz: number, type: number, ttl: number, rdata: Buffer): Promise<void>
  Commit(): Promise<void>
  Reset(): Promise<void>
  Free(): Promise<void>
}

export async function avahiAddAlias(host: string, hostname: string): Promise<AvahiEntryGroupInterface> {
  const bus = getBus()
  const proxy = await bus.getProxyObject('org.freedesktop.Avahi', '/')
  const server = proxy.getInterface('org.freedesktop.Avahi.Server') as any as AvahiMainInterface
  let entryGroupPath = await server.EntryGroupNew()
  let entryGroup = await bus.getProxyObject('org.freedesktop.Avahi', entryGroupPath)
  let entryGroupInt = entryGroup.getInterface('org.freedesktop.Avahi.EntryGroup') as any as AvahiEntryGroupInterface

  const _interface = -1
  const protocol = -1
  const flags = 0
  const name = host
  const clazz = 0x01
  const type = 0x05
  const ttl = 60
  const rdata = encodeFQDN(hostname)

  await entryGroupInt.AddRecord(_interface, protocol, flags, name, clazz, type, ttl, rdata)
  await entryGroupInt.Commit()
  return entryGroupInt
}

export async function avahiDeleteAlias(cname: AvahiEntryGroupInterface) {
  await cname.Reset()
  await cname.Free()
}
