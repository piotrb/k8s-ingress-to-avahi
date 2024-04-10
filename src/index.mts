import { KubeConfig } from "@kubernetes/client-node"
import { cleanup as cleanupAvahi } from "./avahi.mjs";
import { parseArgs } from "node:util"
import { IngresTracker } from "./IngresTracker.mjs";

async function main() {
	let args
	try {
		args = parseArgs({
			options: {
				hostname: {
					type: "string",
					short: "h",
				},
				"kube-config": {
					type: "string",
					short: "c"
				},
				namespace: {
					type: "string",
					short: "n",
					default: "default"
				}
			}
		})

		if (args.values.hostname === undefined) {
			console.error("required argument --hostname")
			process.exit(1)
		}
	} catch (e: any) {
		if (e.code == "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
			console.error(e.message)
			process.exit(1)
		}
		if (e.code == "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL") {
			console.error(e.message)
			process.exit(1)
		}
		throw e
	}

	const kc = new KubeConfig();
	if (args.values["kube-config"] !== undefined) {
		kc.loadFromFile(args.values["kube-config"])
	} else {
		kc.loadFromDefault();
	}

	const tracker = new IngresTracker(args.values.hostname, kc, args.values.namespace!)
	await tracker.run()
}

main().catch((e) => {
	console.error("main failed with:", e, e.type)
}).finally(() => {
	cleanupAvahi()
})
