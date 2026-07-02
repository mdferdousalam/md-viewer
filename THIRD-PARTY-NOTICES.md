# Third-Party Notices

Markdown Viewer is proprietary software (see `LICENSE`), but it incorporates the
third-party open-source components listed below. Each component remains licensed under its
own terms, reproduced or referenced here. The "All Rights Reserved" terms of this project
do **not** apply to these components.

| Component | Version | License |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 31.7.7 | MIT |
| [electron-updater](https://github.com/electron-userland/electron-builder) | 6.8.9 | MIT |
| [marked](https://github.com/markedjs/marked) | 13.0.3 | MIT |
| [marked-gfm-heading-id](https://github.com/markedjs/marked-gfm-heading-id) | 4.1.4 | MIT |
| [marked-highlight](https://github.com/markedjs/marked-highlight) | 2.2.4 | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.11 | Apache-2.0 (dual-licensed MPL-2.0 OR Apache-2.0; used here under Apache-2.0) |
| [highlight.js](https://github.com/highlightjs/highlight.js) | 11.11.1 | BSD-3-Clause |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.16.47 | MIT |
| [Mermaid](https://github.com/mermaid-js/mermaid) | 11.16.0 | MIT |

The build tool [esbuild](https://github.com/evanw/esbuild) (MIT) is used at build time but
is not distributed with the application.

The full, unmodified license text of each component is included in that component's package
within `node_modules/` and at the linked upstream repository. The applicable license texts
are reproduced below.

---

## MIT License

Applies to: Electron, electron-updater, marked, marked-gfm-heading-id, marked-highlight,
KaTeX, Mermaid. Copyright notices are held by their respective authors and contributors
(e.g. © GitHub Inc. and Electron contributors; © MarkedJS and Christopher Jeffrey; © Khan
Academy and contributors; © Knut Sveidqvist and Mermaid contributors).

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## BSD 3-Clause License

Applies to: highlight.js. Copyright © 2006, Ivan Sagalaev and highlight.js contributors.

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## Apache License 2.0

Applies to: DOMPurify (© Cure53 and contributors), which is dual-licensed under
MPL-2.0 OR Apache-2.0 and used here under the Apache License, Version 2.0. The full text is
available at https://www.apache.org/licenses/LICENSE-2.0 and in
`node_modules/dompurify/LICENSE`.
