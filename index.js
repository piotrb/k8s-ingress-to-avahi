const k8s = require('@kubernetes/client-node');
const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const {
	cleanup: cleanupAvahi,
	avahiAddAlias,
  avahiDeleteAlias,
	getAvahiInterface,
} = require("./avahi")

const {
	removeItem
} = require("./util")

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
	cleanupAvahi()
	process.exit(0)
}

async function addAlias(server, host, uid) {
	if (!cnames[host]) {
		console.info("Adding", host)

		const entryGroupInt = await avahiAddAlias(server, host, hostname)

		cnames[host] = entryGroupInt
		if(!entriesByUid[uid]) {
			entriesByUid[uid] = {}
		}
		if(!entriesByUid[uid][host]) {
			entriesByUid[uid][host] = true
		}
	}
}

async function deleteAlias(host) {
	if (cnames[host]) {
		console.info("Deleting", host)
		await avahiDeleteAlias(host)
		delete cnames[host]
	}
}

async function handleAdded(apiObj) {
	for (const rule of apiObj.spec.rules) {
		const host = rule.host
		await addAlias(server, host, apiObj.metadata.uid)
	}
}

async function handleDeleted(apiObj) {
	for (const rule of apiObj.spec.rules) {
		const host = rule.host
		await deleteAlias(host)
	}
	delete entriesByUid[apiObj.metadata.uid]
}

async function handleModified(apiObj) {
	let hostnames = Object.keys(entriesByUid[apiObj.metadata.uid])
	for (const rule of apiObj.spec.rules) {
		const host = rule.host
		hostnames = removeItem(hostnames, host)
		if(!entriesByUid[apiObj.metadata.uid][host]) {
			await addAlias(server, host, apiObj.metadata.uid)
		}
	}
	for (host of hostnames) {
		await deleteAlias(host)
	}
}

async function main() {

	const server = getAvahiInterface()

	const watch = new k8s.Watch(kc);

	await watch.watch(`/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses`, {}, async (phase, apiObj) => {
		// console.info(phase, apiObj)
		console.info(`${phase} - ${apiObj.metadata.namespace}/${apiObj.metadata.name}`)

		switch(phase) {
			case "ADDED":
				await handleAdded(apiObj)
				break;
			case "DELETED":
				await handleDeleted(apiObj)
				break;
			case "MODIFIED":
				await handleModified(apiObj)
				break;
			default:
				console.error("got unhandled event", phase, apiObj)
		}
	}, (err) => {
		console.info(done, err)
	})
}

main().catch((e) => {
	console.error(e)
})
