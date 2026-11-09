// The one script every extension page loads. Each page names itself in <body data-page>, so the
// catalog, mode data and picker ship once for all three pages.
import { mountOnboarding } from "./onboarding.mjs";
import { mountPage } from "./common.mjs";

if (document.body.dataset.page === "onboarding") mountOnboarding();
else mountPage();
