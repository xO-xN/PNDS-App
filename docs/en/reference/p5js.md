# Creating Digital Scores with P5.js

[p5.js](https://p5js.org) is an open-source JavaScript library for creative coding, built for artists, designers and educators, and carrying forward Processing's easy-to-learn design philosophy. It treats the web browser as an interactive digital canvas, wrapping Canvas and WebGL behind an intuitive API so creators can readily build generative art, dynamic visuals and multimedia interactive works.

PNDS takes p5.js as its foundational authoring tool for digital scores. Sketches run in the Project's own performer / monitor browser pages (page requirements in the [runtime contract](./runtime-contract.md) §10): the performer's interactions on the page drive the sound engine over the Project's real-time link; PNDS App merely embeds the monitor page in an iframe and takes no part in the score's logic. For the concept of the digital score see [digital-score.md](./digital-score.md).

How to write sketches, and the template Project's structure, are maintained in the [PNDS-Template](https://github.com/xO-xN/PNDS-Template) repository.

## Load p5 from an App shared package through the project's origin

In creation mode, use “Add shared package” in the Modules heading, choose this
App's p5 candidate, and enter a new project version. The reference follows
[manifest.md](./manifest.md); resources remain in the App. Author server wiring:

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
<script src="/shared/p5.js"></script>
```

The project creates Express `app`; this fragment does not create or install a
dependency. Node's standard library can also read and serve the entry: a runnable
example lives at `examples/shared-p5/` in the App source. Phones cannot read a
Mac's absolute filesystem path; do not use `file://` or a CDN. The trusted HTTPS
entry proxies the same route, and pages retain the relative address.

p5 2.3.4 is a validation candidate. Authors must validate and adapt older sketches'
loading, image, input and timing behavior; adoption never rewrites sketches.
After a cold offline open, confirm actual circle rendering and input, then test
refresh, restart, shutdown and bundle installation. HTTP 200 or health ready
cannot prove JavaScript execution or correct drawing. Models are not shared p5.
