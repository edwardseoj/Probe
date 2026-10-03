import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  banner: {
    js: "#!/usr/bin/env node",
  },
  dts: false,
  clean: true,
});
