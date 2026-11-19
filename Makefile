# Shortcuts; everything here also works without make (see docs/development.md).
.PHONY: setup setup-mobile start dev verify test-ui android ios licenses backup

setup:          ## backend + web on a fresh machine
	scripts/bootstrap.sh
setup-mobile:   ## + mobile toolchain and the iroh library
	scripts/bootstrap.sh --mobile
start:          ## backend, web dev server and app dev server
	scripts/bootstrap.sh --no-tests --start
dev:
	npm run dev
verify:         ## checks, unit tests, typecheck, web build
	npm run verify
test-ui:
	npm run test:ui
android:        ## release AAB + APKs in mobile-app/dist
	npm --prefix mobile-app run release:android
ios:            ## iroh XCFramework + prebuild + pods
	npm --prefix mobile-app run iroh:ios && cd mobile-app && npx expo prebuild --platform ios --clean && cd ios && pod install
licenses:       ## regenerate THIRD-PARTY-NOTICES.md
	node scripts/licenses.mjs
backup:         ## encrypted backup of secrets and state
	scripts/export-secrets.sh
