import js from "@eslint/js";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "dist/**",
      "build/**",

      // Generated Docusaurus files
      "Documentation/.docusaurus/**",
      "Documentation/build/**",
    ],
  },

  js.configs.recommended,

  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        // Standard Node 18+ globals used by the root utility scripts
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
      },
    },
  },
];