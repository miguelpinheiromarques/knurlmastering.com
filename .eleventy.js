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
eleventyConfig.addNunjucksAsyncShortcode("image", async function(src, alt, sizes, cls = "") {
  let metadata = await Image(src, {
    widths: [450, 600, 900, 1200], 
    formats: ["webp", "jpeg"],
    urlPath: "/img/",
    outputDir: "./_site/img/"
  });

  let imageAttributes = {
    alt,
    sizes,
    class: cls, // <--- This adds your custom class to the <img> tag
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
