.PHONY : doc build clean dist

pre_build:
	git rev-parse HEAD > .git-ref
	mkdir -p build/src
	mkdir -p build/demo/kitchen-sink
	mkdir -p build/textarea/src
	
	cp -r demo/kitchen-sink/styles.css build/demo/kitchen-sink/styles.css
	cp demo/kitchen-sink/logo.png build/demo/kitchen-sink/logo.png
	cp -r doc/site/images build/textarea

build: pre_build
	./Makefile.dryice.js normal
	./Makefile.dryice.js demo

# Minimal build: call Makefile.dryice.js only if our sources changed
basic: build/src/ace.js

build/src/ace.js : ${wildcard lib/*} \
                   ${wildcard lib/*/*} \
                   ${wildcard lib/*/*/*} \
                   ${wildcard lib/*/*/*/*} \
                   ${wildcard lib/*/*/*/*/*} \
                   ${wildcard lib/*/*/*/*/*/*}
	./Makefile.dryice.js

doc:
	cd doc;\
	(test -d node_modules && npm update) || npm install;\
	node build.js

clean:
	rm -rf build
	rm -rf ace-*
	rm -f ace-*.tgz

ace.tgz: build
	mv build ace-`./version.js`/
	cp Readme.md ace-`./version.js`/
	cp LICENSE ace-`./version.js`/
	tar cvfz ace-`./version.js`-$(SHA).tgz ace-`./version.js`/

SHA ?= $(shell git rev-parse HEAD)
VERSION=$(shell ./version.js)
RELEASE=v$(VERSION)-$(SHA)
TAR=local.tar.gz
GITHUB_URL=https://github.com/overleaf/ace-builds

release:
	cd build && git checkout master
	cd build && git checkout -b release-$(RELEASE)
	cd build && git stage -A
	cd build && git commit -m "[misc] release $(RELEASE)"
	cd build && git tag $(RELEASE)
	cd build && git push origin release-$(RELEASE)
	cd build && git push origin $(RELEASE)

package_url:
	@echo $(GITHUB_URL)/archive/$(RELEASE).tar.gz

minimal: build/loose_files
build/loose_files:
	mkdir -p build/
	echo "module.exports='$(RELEASE)'" > build/release.js
	echo "module.exports='$(VERSION)'" > build/version.js
	cp build_support/package.json build/
	cp LICENSE build/

minimal: build/src-noconflict
.PHONY: build/src-noconflict
build/src-noconflict:
	./Makefile.dryice.js --nc

minimal: build/src-min-noconflict
.PHONY: build/src-min-noconflict
build/src-min-noconflict:
	./Makefile.dryice.js -m --nc

archive: $(TAR)
.PHONY: $(TAR)
$(TAR):
	mkdir -p builds/
	tar --create --exclude-vcs build/ | gzip > $@

local:
	$(MAKE) minimal -j2
	$(MAKE) archive

dist: clean build ace.tgz
