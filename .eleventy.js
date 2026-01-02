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
// In your .eleventy.js config
eleventyConfig.addShortcode("image", async function(src, alt, sizes, className, loading) {
  
  // 1. Define the default if no argument is provided
  // If 'loading' is undefined, we use "lazy".
  let loadingStrategy = loading || "lazy"; 

  let metadata = await Image(src, {
    widths: [450, 600, 900, 1200], // (Your existing widths)
    formats: ["webp", "jpeg"],
    outputDir: "./_site/img/",
    urlPath: "/img/"
  });

  let imageAttributes = {
    class: className,
    sizes: sizes,
    loading: loadingStrategy, // <--- Add this line!
    decoding: "async",
    alt: alt
  };

  return Image.generateHTML(metadata, imageAttributes);
});

  return {
    dir: {
      input: "src",
      output: "_site"
    }
  };
};
