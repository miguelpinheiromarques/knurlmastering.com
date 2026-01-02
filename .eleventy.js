const Image = require("@11ty/eleventy-img");

module.exports = function(eleventyConfig) {
  
  // ... (your other config) ...

  eleventyConfig.addShortcode("image", async function(src, alt, sizes, className, loading, widthsList) {
    
    // 1. Handle Loading (Default to 'lazy' if empty)
    let loadingStrategy = loading || "lazy";

    // 2. Handle Widths (Default to global list if empty)
    // This allows you to pass [450] for thumbnails, or use the big list for heroes
    let targetWidths = widthsList || [450, 600, 900, 1200]; 

    let metadata = await Image(src, {
      widths: targetWidths,
      formats: ["webp", "jpeg"],
      outputDir: "./_site/img/",
      urlPath: "/img/"
    });

    let imageAttributes = {
      // Fix: Ensure class is an empty string if undefined
      class: className || "", 
      sizes: sizes,
      loading: loadingStrategy,
      decoding: "async",
      alt: alt
    };

    // 3. Add fetchpriority only for eager images
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
