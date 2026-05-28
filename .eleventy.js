module.exports = async function(eleventyConfig) {
  const { default: Image } = await import("@11ty/eleventy-img");

  // -----------------------------------------------------------------
  // 1. CONFIG (CSS, Favicons, Social Images)
  // -----------------------------------------------------------------
  eleventyConfig.addWatchTarget("./src/css/");
  
  eleventyConfig.addShortcode("version", function () {
    return String(Date.now());
  });  
  
  // Passthrough copies
  eleventyConfig.addPassthroughCopy("./src/css/"); 
  eleventyConfig.addPassthroughCopy("./src/favicon.svg");
  eleventyConfig.addPassthroughCopy("./src/apple-touch-icon.png");
  eleventyConfig.addPassthroughCopy("./src/favicon-96x96.png");
  eleventyConfig.addPassthroughCopy("./src/knurlmastering-og.jpg");
  
  eleventyConfig.addPassthroughCopy("./src/llms.txt");
  eleventyConfig.addPassthroughCopy("./src/robots.txt");  
  
  eleventyConfig.addPassthroughCopy("./src/_headers");  
  eleventyConfig.addPassthroughCopy("./src/_redirects");    
  
  eleventyConfig.addPassthroughCopy("./src/.well-known/");
  eleventyConfig.addPassthroughCopy("./src/api/");
  eleventyConfig.addPassthroughCopy("./src/docs/");

  // -----------------------------------------------------------------
  // 2. IMAGE SHORTCODE (v3 Async Compatible)
  // -----------------------------------------------------------------
  eleventyConfig.addShortcode("image", async function(src, alt, sizes, className, loading, widthsList) {
    
    // Default to 'lazy' if no specific loading is passed
    let loadingStrategy = loading || "lazy";

    // Default to global widths if no specific list is passed
    let targetWidths = widthsList || [450, 900, 1200, 1800, 2400];

    let metadata = await Image(src, {
      widths: targetWidths,
      formats: ["webp", "jpeg"],
      outputDir: "./_site/img/",
      urlPath: "/img/",
      sharpWebpOptions: { quality: 85 },
      sharpJpegOptions: { quality: 85 }
    });

    let imageAttributes = {
      class: className || "",
      sizes: sizes,
      loading: loadingStrategy,
      decoding: "async",
      alt: alt
    };

    if (loadingStrategy === "eager") {
      imageAttributes.fetchpriority = "high";
    }

    return Image.generateHTML(metadata, imageAttributes);
  });


  // -----------------------------------------------------------------
  // 3. FINAL RETURN
  // -----------------------------------------------------------------
  return {
    dir: {
      input: "src",
      output: "_site"
    }
  };
};
