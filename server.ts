import { buildCloudApp } from "./server/cloud/app.js";

export default await buildCloudApp({ serveStatic: true });
