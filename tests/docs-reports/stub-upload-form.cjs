// The upload form is a client component (useFormState), which react-dom's server build
// cannot run outside Next. The panel test stubs it so the list half stays testable.
const React = require("react");
module.exports = { UploadForm: (p) => React.createElement("div", { "data-testid": "upload-form", "data-disabled": p.disabled ? "1" : "0" }) };
