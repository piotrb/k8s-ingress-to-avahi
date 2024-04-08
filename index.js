const k8s = require('@kubernetes/client-node');
const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const dbus = require('dbus-next');
const bus = dbus.systemBus()

const hostname = process.argv[3]
const namespace = process.argv[4] || "default"

const cnames = {}
const entriesByUid = {}

process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)

async function cleanup() {
	const keys = Object.keys(cnames)
	for (k in keys) {
		await cnames[keys[k]].Reset()
		await cnames[keys[k]].Free()
	}
	bus.disconnect()
	process.exit(0)
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

function removeItem(arr, value) { 
  const index = arr.indexOf(value);
  if (index > -1) {
    arr.splice(index, 1);
  }
  return arr;
}

async function avahiAddAlias(server, host, uid) {
	if (!cnames[host]) {
		console.info("Adding", host)

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
		cnames[host] = entryGroupInt
		if(!entriesByUid[uid]) {
			entriesByUid[uid] = {}
		}
		if(!entriesByUid[uid][host]) {
			entriesByUid[uid][host] = true
		}
	}
}

async function avahiDeleteAlias(host) {
	if (cnames[host]) {
		console.info("Deleting", host)
		await cnames[host].Reset()
		await cnames[host].Free()
		delete cnames[host]
	}
}

async function main() {

	let server;

	const proxy = await bus.getProxyObject('org.freedesktop.Avahi', '/')
	server = proxy.getInterface('org.freedesktop.Avahi.Server')

	const watch = new k8s.Watch(kc);

	await watch.watch(`/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses`, {}, async (phase, apiObj) => {
		// console.info(phase, apiObj)
		console.info(`${phase} - ${apiObj.metadata.namespace}/${apiObj.metadata.name}`)

		if (phase == "ADDED") {
			for (x in apiObj.spec.rules) {
				const host = apiObj.spec.rules[x].host
				await avahiAddAlias(server, host, apiObj.metadata.uid)
			}
		} else if (phase == "DELETED") {
			const hostnames = Object.keys(entriesByUid[apiObj.metadata.uid])
			console.info(hostnames)
			for (x in apiObj.spec.rules) {
				const host = apiObj.spec.rules[x].host
				await avahiDeleteAlias()
			}
			delete entriesByUid[apiObj.metadata.uid]
		} else if (phase == "MODIFIED") {
			let hostnames = Object.keys(entriesByUid[apiObj.metadata.uid])
			for (x in apiObj.spec.rules) {
				const host = apiObj.spec.rules[x].host
				hostnames = removeItem(hostnames, host)
				if(!entriesByUid[apiObj.metadata.uid][host]) {
					await avahiAddAlias(server, host, apiObj.metadata.uid)
				}
			}
			for (host of hostnames) {
				await avahiDeleteAlias(host)
			}
		}

	}, (err) => {
		console.info(done, err)
	})
}

main().catch((e) => {
	console.error(e)
})
