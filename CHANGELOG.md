# Changelog

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
