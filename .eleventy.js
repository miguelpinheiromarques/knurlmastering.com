module.exports = function(eleventyConfig) {
  // Pass CSS through to the output
  eleventyConfig.addPassthroughCopy("./src/css");
  
  // Watch for changes in style
  eleventyConfig.addWatchTarget("./src/css/");

  return {
    dir: {
      input: "src",
      output: "_site"
    }
  };
};
