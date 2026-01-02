module.exports = function(eleventyConfig) {
  // Pass CSS through
  eleventyConfig.addPassthroughCopy("./src/css");
  
  // NEW: Pass the covers folder through
  eleventyConfig.addPassthroughCopy("./src/covers");
  
  // Watch for changes
  eleventyConfig.addWatchTarget("./src/css/");

  return {
    dir: {
      input: "src",
      output: "_site"
    }
  };
};