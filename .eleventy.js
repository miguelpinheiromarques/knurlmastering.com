const Image = require("@11ty/eleventy-img");

module.exports = function(eleventyConfig) {
  
  // -----------------------------------------------------------------
  // 1. RESTORED CONFIG (CSS, Favicons, Social Images)
  // -----------------------------------------------------------------
  eleventyConfig.addWatchTarget("./src/css/");
  
  eleventyConfig.addShortcode("version", function () {
    return String(Date.now());
  });  
  
  // Important: If your CSS is just a static file (not Sass/PostCSS), 
  // you usually need this line too. If your CSS is missing in the 
  // output folder, uncomment the next line:
  eleventyConfig.addPassthroughCopy("./src/css/"); 

  eleventyConfig.addPassthroughCopy("./src/favicon.svg");
  eleventyConfig.addPassthroughCopy("./src/apple-touch-icon.png");
  eleventyConfig.addPassthroughCopy("./src/favicon-96x96.png");
  eleventyConfig.addPassthroughCopy("./src/knurlmastering-og.jpg");


  // -----------------------------------------------------------------
  // 2. IMAGE SHORTCODE (With Custom Widths & Eager Loading Logic)
  // -----------------------------------------------------------------
  eleventyConfig.addShortcode("image", async function(src, alt, sizes, className, loading, widthsList) {
    
    // Default to 'lazy' if no specific loading is passed
    let loadingStrategy = loading || "lazy";

    // Default to global widths if no specific list is passed
    let targetWidths = widthsList || [450, 600, 900, 1200]; 

    let metadata = await Image(src, {
      widths: targetWidths,
      formats: ["webp", "jpeg"],
      outputDir: "./_site/img/",
      urlPath: "/img/"
    });

    let imageAttributes = {
      class: className || "", // Fix: Empty string if class is undefined
      sizes: sizes,
      loading: loadingStrategy,
      decoding: "async",
      alt: alt
    };

    // If it's eager (hero image), set priority to high
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
