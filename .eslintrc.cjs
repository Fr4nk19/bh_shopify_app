/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "eslint-config-prettier",
  ],
  rules: {
    "no-console": "off",
    "react/prop-types": "off",
  },
};
