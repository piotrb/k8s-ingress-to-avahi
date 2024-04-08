const dbus = require('dbus-next');
const bus = dbus.systemBus()

function cleanup() {
	bus.disconnect()
}

function encodingLength(n) {
  if (n === '.') return 1
  return Buffer.byteLength(n) + 2
}

function encodeFQDN(name) {
	let buf = Buffer.allocUnsafe(encodingLength(name))

	let offset = 0
	let parts = name.split('.')
	for (let i = 0; i < parts.length; i++) {
		const length = buf.write(parts[i],offset + 1)
		buf[offset] = length
		offset += length + 1
	}

	buf[offset++] = 0
	return buf
}

async function avahiAddAlias(server, host, hostname) {
  let entryGroupPath = await server.EntryGroupNew()
  let entryGroup = await bus.getProxyObject('org.freedesktop.Avahi',  entryGroupPath)
  let entryGroupInt = entryGroup.getInterface('org.freedesktop.Avahi.EntryGroup')

  var interface = -1
  var protocol = -1
  var flags = 0
  var name = host
  var clazz = 0x01
  var type = 0x05
  var ttl = 60
  var rdata = encodeFQDN(hostname)

  await entryGroupInt.AddRecord(interface, protocol, flags, name, clazz, type, ttl, rdata)
  await entryGroupInt.Commit()
  return entryGroupInt
}

async function avahiDeleteAlias(host) {
  await cnames[host].Reset()
  await cnames[host].Free()
}

async function getAvahiInterface() {
	const proxy = await bus.getProxyObject('org.freedesktop.Avahi', '/')
	server = proxy.getInterface('org.freedesktop.Avahi.Server')
	return server
}

module.exports = {
  cleanup,
  avahiAddAlias,
  avahiDeleteAlias,
  getAvahiInterface,
}
