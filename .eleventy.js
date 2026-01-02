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
eleventyConfig.addShortcode("image", async function(src, alt, sizes, className, loading) {
  
  // 1. Default to lazy if not specified
  let loadingStrategy = loading || "lazy"; 

  let metadata = await Image(src, {
    widths: [450, 600, 900, 1200],
    formats: ["webp", "jpeg"],
    outputDir: "./_site/img/",
    urlPath: "/img/"
  });

  let imageAttributes = {
    class: className,
    sizes: sizes,
    loading: loadingStrategy, 
    decoding: "async",
    alt: alt
  };

  // 2. THE FIX: If it's eager, boost the priority
  if (loadingStrategy === "eager") {
    imageAttributes.fetchpriority = "high";
  }

  return Image.generateHTML(metadata, imageAttributes);
});

  return {
    dir: {
      input: "src",
      output: "_site"
    }
  };
};
