const assert = require("node:assert/strict");
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, join, relative } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const expo = createRequire(require.resolve("expo/package.json"));
const metroConfig = createRequire(
  expo.resolve("@expo/metro-config/package.json"),
);
const postcss = metroConfig("postcss");

test("shell-quote rejects a line terminator after a comment token", () => {
  const { quote, parse } = require("shell-quote");
  assert.throws(
    () => quote(["echo", "ok", { comment: "x" }, "a\nUNTRUSTED_COMMAND;#"]),
    TypeError,
  );
  const args = ["echo", "ordinary argument", "literal;value"];
  assert.deepEqual(parse(quote(args)), args);
});

for (const withFrom of [false, true]) {
  test(`PostCSS does not disclose an external source map (from=${withFrom})`, (t) => {
    const local = join(root, ".local");
    mkdirSync(local, { recursive: true });
    const directory = mkdtempSync(join(local, "security-postcss-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const stylesheet = join(directory, "css", "input.css");
    mkdirSync(dirname(stylesheet));
    const secretMap = join(directory, "private.map");
    const secret = "PRIVATE_SOURCE_CONTENT_MUST_NOT_BE_READ";
    writeFileSync(
      secretMap,
      JSON.stringify({
        version: 3,
        sources: ["private.js"],
        sourcesContent: [secret],
        names: [],
        mappings: "AAAA",
      }),
    );
    const annotation = withFrom
      ? relative(dirname(stylesheet), secretMap)
      : secretMap;
    const result = postcss()
      .process(`a{color:red}\n/*# sourceMappingURL=${annotation} */`, {
        ...(withFrom ? { from: stylesheet } : {}),
        map: { inline: false },
      })
      .sync();
    assert.ok(!result.map?.toString().includes(secret));
  });
}

const consumers = {
  Expo: createRequire(expo.resolve("@expo/metro/package.json")),
  ReactNative: createRequire(
    require.resolve("@react-native/community-cli-plugin/package.json"),
  ),
};
for (const [name, consumer] of Object.entries(consumers)) {
  const metroPackage = consumer.resolve("metro/package.json");
  const assets = require(join(dirname(metroPackage), "src", "Assets.js"));
  const image = join(root, "assets", "icon.png");
  const content = readFileSync(image);
  const expected = {
    width: content.readUInt32BE(16),
    height: content.readUInt32BE(20),
  };

  test(`${name} resolves the patched Metro and reads image bytes`, () => {
    assert.equal(require(metroPackage).version, "0.83.8");
    assert.deepEqual(assets.getAssetSize("png", content, image), expected);
  });

  test(`${name} Metro still generates image metadata from a file path`, async () => {
    const result = await assets.getAssetData(
      image,
      "assets/icon.png",
      [],
      "ios",
      "/assets",
    );
    assert.equal(result.width, expected.width);
    assert.equal(result.height, expected.height);
    assert.deepEqual(result.files, [image]);
  });
}
