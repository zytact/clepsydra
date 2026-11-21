# Changelog

## [1.28.3-clepsydra.1](https://github.com/zytact/clepsydra/compare/v1.28.1-clepsydra.6...v1.28.3-clepsydra.1) (2026-11-21)


### Bug Fixes

* **quota:** drop runs dry above, which contradicted use it all ([a9751c4](https://github.com/zytact/clepsydra/commit/a9751c48226e12a8f18c66b65b95402ae45586eb))

## [1.28.1-clepsydra.6](https://github.com/zytact/clepsydra/compare/v1.28.1-clepsydra.5...v1.28.1-clepsydra.6) (2026-11-19)


### Bug Fixes

* **quota:** compute pool stats for unrouted accounts and order antigravity windows ([21dcec2](https://github.com/zytact/clepsydra/commit/21dcec20d7b660556ea8d4f908705426d37c322c))
* **quota:** compute pool stats for unrouted accounts and order antigravity windows ([81bbe2d](https://github.com/zytact/clepsydra/commit/81bbe2dfb82ba2296f7f505f3632fe778f83ce92))

## [1.28.1-clepsydra.5](https://github.com/zytact/clepsydra/compare/v1.28.1-clepsydra.4...v1.28.1-clepsydra.5) (2026-11-19)


### Features

* **auth-files:** show the antigravity cli login as quota-only ([65633d8](https://github.com/zytact/clepsydra/commit/65633d869a44e91714b4da345095a346db3c7374))
* **quota:** chart Antigravity buckets and show quota-only CLI logins ([aa63348](https://github.com/zytact/clepsydra/commit/aa63348426c60300b674d7032cd5e6fef1076514))
* **quota:** chart each antigravity limit on its own ([cdca2c3](https://github.com/zytact/clepsydra/commit/cdca2c3cbcb1509009ea5906bfc53f07640ba487))
* **quota:** leave quota-only accounts out of projected routing ([ec158df](https://github.com/zytact/clepsydra/commit/ec158df90e7071c431d1e673fcea77f772ed6df4))


### Bug Fixes

* **quota:** forecast quota-only accounts at their own burn ([609576b](https://github.com/zytact/clepsydra/commit/609576b320f20b9f195c046b660cb0289df3a018))
* **quota:** keep quota-only accounts out of routing metrics ([8d1ad69](https://github.com/zytact/clepsydra/commit/8d1ad6987172965a2b94a4e1cc3902966e2b5016))
* **quota:** show quota-only logins as not routed before any readings ([f7764e6](https://github.com/zytact/clepsydra/commit/f7764e6e7d8209c648ffaec95fed267688dba713))
* **quota:** skip disabled antigravity buckets and label recorded ones ([c6b4fea](https://github.com/zytact/clepsydra/commit/c6b4fea034ca82bf1cd773ac62ca5281e54b053d))
* **quota:** skip group-blocked routed accounts and gate window headroom ([f3eb1ec](https://github.com/zytact/clepsydra/commit/f3eb1ec5742b4bf41b945777e67523f2058cfcf9))

## [1.28.1-clepsydra.4](https://github.com/zytact/clepsydra/compare/v1.28.1-clepsydra.3...v1.28.1-clepsydra.4) (2026-11-19)


### Bug Fixes

* **quota:** cap use-it-all at the pace a longer window allows ([c0c9628](https://github.com/zytact/clepsydra/commit/c0c96289e79b4a9ca6b54f25eff30372c7a37213))
* **quota:** stop suggesting a 5-hour pace the weekly limit can't sustain ([e6ba46d](https://github.com/zytact/clepsydra/commit/e6ba46d67b3b52c04ff38b25489f81d511087320))

## [1.28.1-clepsydra.3](https://github.com/zytact/clepsydra/compare/v1.28.1-clepsydra.2...v1.28.1-clepsydra.3) (2026-11-19)


### Features

* **quota:** see banked Claude resets and their expiry in the accounts table ([bc4fa9e](https://github.com/zytact/clepsydra/commit/bc4fa9ed3c217e04c531c49710d363d6f1a9bb1a))
* **quota:** show banked resets under the plan ([1d9775a](https://github.com/zytact/clepsydra/commit/1d9775a7ab9e027190610dac63df68775414509b))
* **quota:** show headroom to use the pool before resets ([eb2aebc](https://github.com/zytact/clepsydra/commit/eb2aebc0dc742882e36713335d8c5eecea6e1019))
* **quota:** show how fast to go to use the whole pool before it resets ([ff63788](https://github.com/zytact/clepsydra/commit/ff637886d9612d2af62f5a138a890e9175eb7bfa))


### Bug Fixes

* **quota:** clear reset summary when the grant read fails ([b5cf7c3](https://github.com/zytact/clepsydra/commit/b5cf7c39b5ef4a482f974435ae7200c6671a4a9e))
* **quota:** judge idle accounts' reach and tell not-started windows from used ones ([f735322](https://github.com/zytact/clepsydra/commit/f73532295e37bd4a3226f21660575b5c881264c5))
* **quota:** judge use-it-all reach within the current cycle ([72a3c9d](https://github.com/zytact/clepsydra/commit/72a3c9db6279aafa46d45f0c1e4c5d2f7ecd4654))
* **quota:** measure runs dry against current burn and stop needed pace at empty ([fd3d590](https://github.com/zytact/clepsydra/commit/fd3d59001e6146ac439b2f002d71a77d5f691606))
* **quota:** settle headroom reach and empty states ([60150c1](https://github.com/zytact/clepsydra/commit/60150c1fedc6a1a10461109e72addb3cbcfe3b15))
* **quota:** skip all-zero-weight tiers and read the strategy as the proxy does ([aea3c00](https://github.com/zytact/clepsydra/commit/aea3c00ddfe296917d31b2e982ebeafad7502202))
* **quota:** spill projected traffic past empty accounts and parse strategy like the proxy ([803c935](https://github.com/zytact/clepsydra/commit/803c935cb7ce525cca221204b3ea83cd8b6fbdfe))
* **quota:** split projected traffic by routing strategy ([7646cc0](https://github.com/zytact/clepsydra/commit/7646cc0515877e5db4baeda284b2c218ff67bb96))

## [1.28.1-clepsydra.2](https://github.com/zytact/clepsydra/compare/v1.28.1-clepsydra.1...v1.28.1-clepsydra.2) (2026-11-18)


### Features

* **quota:** default the burn rate window to 6h ([d4a6502](https://github.com/zytact/clepsydra/commit/d4a6502fdeb7a0ef2039edc3cf35bb870be8af04))


### Bug Fixes

* **layout:** leave a gap between the sidebar toggle and the nav icons ([0f2c523](https://github.com/zytact/clepsydra/commit/0f2c5239886ddea4d99db80696ff7b7fa966f856)), closes [#5](https://github.com/zytact/clepsydra/issues/5)
* **layout:** start the sidebar toggle at the sidebar edge ([42aa397](https://github.com/zytact/clepsydra/commit/42aa397a5eee4924d3e2e79d9dbc088a11433e44))
* **quota:** count a reset past the projection from where the projection ends ([be28e4d](https://github.com/zytact/clepsydra/commit/be28e4d54693cbeebea1597d1f0a8b74a902a30d))
* **quota:** count the next reset gain from the accounts that reset then ([3e3af6c](https://github.com/zytact/clepsydra/commit/3e3af6cf1e4ae6af3b1d2443ccfb2b40c2245bfc))
* **quota:** keep the date navigator on its own row ([93f129d](https://github.com/zytact/clepsydra/commit/93f129ded30ef084a34824d96c01e992a8fb2c4e)), closes [#7](https://github.com/zytact/clepsydra/issues/7)
* **quota:** show the next reset from reset times, not a gain threshold ([54e74d6](https://github.com/zytact/clepsydra/commit/54e74d6d0ade4601d492e179f136121ee4aff9b7)), closes [#9](https://github.com/zytact/clepsydra/issues/9)
* **quota:** use usable gain for a reset past the projection ([00ab0e3](https://github.com/zytact/clepsydra/commit/00ab0e3d91c02c74428704e5e50a5db2d2b2a233))
* **ui:** shrink the panel to upstream size and keep the quota page steady ([325598f](https://github.com/zytact/clepsydra/commit/325598fc2e53c5b62b17b239d051a7752888407e))
