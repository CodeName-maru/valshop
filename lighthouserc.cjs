module.exports = {
  ci: {
    collect: {
      url: [process.env.DEPLOY_URL || "http://localhost:3000"],
      settings: {
        preset: "mobile",
        onlyCategories: ["performance", "pwa"],
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.7 }],
        "categories:pwa": ["error", { minScore: 0.8 }],
        "interactive": ["error", { maxNumericValue: 3000 }],
        "first-contentful-paint": ["warn", { maxNumericValue: 1800 }],
      },
    },
  },
};
