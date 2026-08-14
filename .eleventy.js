module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/img");

  eleventyConfig.addCollection("posts", function (collectionApi) {
    return collectionApi.getFilteredByGlob("src/posts/*.md").reverse();
  });

  eleventyConfig.addFilter("dateDisplay", (date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  });

  eleventyConfig.addFilter("dateRfc", (date) => {
    return new Date(date).toUTCString();
  });

  eleventyConfig.addFilter("getPrevPost", (posts, currentUrl) => {
    const idx = posts.findIndex((p) => p.url === currentUrl);
    return idx < posts.length - 1 ? posts[idx + 1] : null;
  });

  eleventyConfig.addFilter("getNextPost", (posts, currentUrl) => {
    const idx = posts.findIndex((p) => p.url === currentUrl);
    return idx > 0 ? posts[idx - 1] : null;
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
    },
  };
};
