const Image = require("@11ty/eleventy-img");

module.exports = function(eleventyConfig) {
  
  // 1. Pass CSS and Covers through (Keep your existing settings)
  eleventyConfig.addPassthroughCopy("./src/css");
  eleventyConfig.addWatchTarget("./src/css/");
  eleventyConfig.addPassthroughCopy("./src/favicon.svg");
  eleventyConfig.addPassthroughCopy("./src/apple-touch-icon.png");
  eleventyConfig.addPassthroughCopy("./src/favicon-96x96.png");
  eleventyConfig.addPassthroughCopy("./src/knurlmastering-og.jpg");

  // 2. Define the Image Optimization Shortcode
  eleventyConfig.addNunjucksAsyncShortcode("image", async function(src, alt, sizes) {
    let metadata = await Image(src, {
      widths: [300, 600, 900, 1200], 
      formats: ["webp", "jpeg"],  // specific formats
      urlPath: "/img/",           // Path in the URL
      outputDir: "./_site/img/"   // Where to save files on disk
    });

    let imageAttributes = {
      alt,
      sizes,
      loading: "lazy",
      decoding: "async",
    };

    // Generates the <picture> tag automatically
    return Image.generateHTML(metadata, imageAttributes);
  });

  return {
    dir: {
      input: "src",
      output: "_site"
    }
  };
};
