import 'source-map-support/register.js'

import { KubeConfig } from "@kubernetes/client-node"
import { cleanup as cleanupAvahi } from "./avahi.mjs";
import { parseArgs } from "node:util"
import { IngresTracker } from "./IngresTracker.mjs";

import { BaseLogger, Logger, LoggerOptions, pino } from 'pino'
import PinoPretty from 'pino-pretty'

async function main(options: { kubeConfig?: string, hostname: string, logger: BaseLogger }) {
	const kc = new KubeConfig();
	if (options.kubeConfig !== undefined) {
		kc.loadFromFile(options.kubeConfig)
	} else {
		kc.loadFromDefault();
	}

	const tracker = new IngresTracker({ hostname: options.hostname, kc, logger: options.logger })
	await tracker.run()
}

function exec() {
	let args
	try {
		args = parseArgs({
			options: {
				hostname: {
					type: "string",
					short: "h",
					default: process.env.NODE_NAME !== undefined ? `${process.env.NODE_NME}.local` : undefined,
				},
				"kube-config": {
					type: "string",
					short: "c"
				},
				json: {
					type: "boolean",
					default: false
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

	var logger: Logger

	const loggerOptions: LoggerOptions = {
		formatters: {
			bindings(bindings) {
				delete bindings.pid
				delete bindings.hostname
				return bindings
			}
		}
	}

	if (args.values.json) {
		logger = pino(loggerOptions)
	} else {
		const pino_pretty = PinoPretty.build({
			colorize: true,
			colorizeObjects: true,
			sync: true,
		})
		logger = pino(loggerOptions, pino_pretty)
	}

	logger.info({ args: { kubeConfig: args.values["kube-config"], hostname: args.values.hostname } }, "Launching")

	main({ kubeConfig: args.values["kube-config"], hostname: args.values.hostname, logger }).then(() => {
		logger.info("done")
	}).catch((e) => {
		logger.error({ error: e }, `main failed with error: (${e.type}) - ${e}`)
		process.exit(1)
	}).finally(() => {
		cleanupAvahi()
	})
}

exec()
