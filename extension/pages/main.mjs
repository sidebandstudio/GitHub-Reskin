// The one script every extension page loads. Each page names itself in <body data-page>, so the
// catalog, mode data and picker ship once for all three pages.
import { mountOnboarding } from "./onboarding.mjs";
import { mountPage } from "./common.mjs";
import { mountSettings } from "./settings.mjs";

const page = document.body.dataset.page;
if (page === "onboarding") mountOnboarding();
else if (page === "settings") mountSettings();
else mountPage();
