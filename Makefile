build:
	docker build . -t k8s-ingress-to-avahi

run: build
	docker run --rm \
		--network host \
		-v /var/run/dbus:/var/run/dbus \
		-v ~/.kube/config:/home/node/.kube/config \
		k8s-ingress-to-avahi \
		--hostname kpi1.local

watch:
	npx tsc --watch
