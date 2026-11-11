# Creating Digital Scores with P5.js

[p5.js](https://p5js.org) is an optional JavaScript creative-coding library for Canvas and WebGL drawing. Blank does not include p5 by default; choose a visual approach for the task.

Sketches run in the project's performer/monitor pages; the project defines interaction and sound mappings. See [page ownership](./runtime-contract.md#1-participants-and-ownership) and the [digital-score concept](./digital-score.md).

## Load p5 from an App shared package through the project's origin

Adoption steps are in [Add modules and shared packages](../app-tutorial.md#add-modules-and-shared-packages). The following example defines server wiring:

```js
const shared = JSON.parse(process.env.PNDS_SHARED_LIBRARIES || '{}').p5
if (!shared || shared.version !== '2.3.4' || shared.kind !== 'browser') {
  throw new Error('Required shared p5 2.3.4 is unavailable')
}
// Install this fixed route on both monitor and performer servers.
app.get('/shared/p5.js', (_request, response) => response.sendFile(shared.path))
```

The browser loads a relative same-origin URL:

```html
<script src="./shared/p5.js"></script>
```

The project creates Express `app`; this fragment does not create or install a
dependency. Node's standard library can also read and serve the entry. Phones cannot read a
Mac's absolute filesystem path; do not use `file://` or a CDN. Relative URLs retain
the [browser confirmation prefix](./runtime-contract.md#browser-participation-protocol-1-295);
use `PNDS_PARTICIPATION.resource(relative)` for dynamic resources. The trusted HTTPS
entry uses the same project routes.

p5 2.3.4 is the current exact shared version. Authors must validate and adapt older sketches'
loading, image, input and timing behavior; adoption never rewrites sketches.
After a cold offline open, confirm actual drawing and input, then test
refresh, restart, shutdown and bundle installation. HTTP 200 or health ready
cannot prove JavaScript execution or correct drawing. Models are not shared p5.
