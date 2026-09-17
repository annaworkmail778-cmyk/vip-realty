import next from "eslint-config-next";

const config = [
  { ignores: [".next/**", "node_modules/**", "scripts/**", "public/**"] },
  ...next,
];

export default config;
