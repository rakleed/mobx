import fs from "fs";
import path from "path";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import typescript from "rollup-plugin-typescript2";
import pkg from "./package.json";

// rollup-plugin-typescript2 only strips types and downlevels down to the
// root tsconfig's `target` (es6), so arrow functions, `const`/`let`,
// destructuring, template literals etc. would otherwise reach dist/index.js
// as-is. Babel still runs afterwards (via .babelrc.js, same as before the
// TypeScript migration) to downlevel that to the postinstall-tested `eslint`
// peer range down to ^3.0.0.
//
// rollup-plugin-typescript2 also writes a standalone .d.ts for every source
// module it compiles (dist/utils.d.ts, dist/missing-observer.d.ts, ...), not
// just the bundled entry point — dist/index.d.ts is fully self-contained and
// none of them are referenced from anywhere, so they're removed below.
//
// Finally, rollup-plugin-typescript2 requires an ES module target so Rollup
// can bundle the sources, so src/index.ts is written as `export default
// {...}` — but the bundled runtime output is a single CommonJS export,
// `module.exports = <value>`, not an ES default export wrapped in `.default`.
// A declaration using `export default` only lines up with that shape under
// `esModuleInterop`; a plain `import mobx from "eslint-plugin-mobx"` without
// it would type-check but read `mobx.default`, which is `undefined` at
// runtime. `export =` matches `module.exports = <value>` unconditionally, so
// the generated declaration is patched to use it too.
const fixDeclarationOutput = () => ({
  name: "fix-declaration-output",
  writeBundle(options) {
    const distDir = path.dirname(options.file);
    const declarationPath = path.join(distDir, "index.d.ts");
    const declaration = fs.readFileSync(declarationPath, "utf8");
    const patched = declaration.replace(/^export default (\w+);\s*$/m, "export = $1;");
    if (patched === declaration) {
      throw new Error(
        `Could not find an "export default <name>;" statement to patch in ${declarationPath}`
      );
    }
    fs.writeFileSync(declarationPath, patched);

    for (const entry of fs.readdirSync(distDir)) {
      if (entry.endsWith(".d.ts") && entry !== "index.d.ts") {
        fs.unlinkSync(path.join(distDir, entry));
      }
    }
  },
});

export default [
  {
    input: "src/index.ts",
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript(),
      babel({
        babelHelpers: "bundled",
        exclude: "**/node_modules/**",
        // @rollup/plugin-babel's default extensions don't include ".ts" - by
        // the time this runs, rollup-plugin-typescript2 has already emitted
        // plain JS for these modules, but the module ids still end in ".ts".
        extensions: [".js", ".jsx", ".es6", ".es", ".mjs", ".cjs", ".ts"],
      }),
      fixDeclarationOutput(),
    ],
    output: [
      { file: pkg.main, format: "cjs", exports: "auto" },
    ],
  },
];
