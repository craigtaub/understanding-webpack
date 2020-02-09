import ast from "abstract-syntax-tree";
import path from "path";
import { eventEmitter } from "./lifecycle.mjs";

/*
 * Template to be used for each module.
 */
const buildModuleTemplateString = moduleCode => `
(function(module, _ourRequire) {
  "use strict";
  ${moduleCode}
})
`;

/*
 * Our main template containing the bundles runtime.
 */
const buildRuntimeTemplateString = allModules => `
(function(modules) {
  // Bootstrap. Define runtime.
  installedModules = {}
  function _our_require_(moduleId) {
    // Module in cache?
    if (installedModules[moduleId]) {
        // return function exported in module
       return installedModules[moduleId].exports
    }

    // Get module
    module = {
       i: moduleId,
       exports: {},
    }
    // Execute module function
    modules[moduleId].call({},
        module,  
        _our_require_
    );

    // Return exports of module
    return module.exports;
  }

  // Load entry module via id + return exports
  return _our_require_(0);

})
/* Dep tree */
([
 ${allModules}
]); 
`;

/* Replacing ESM import with our functions.
 * Use below code snippet to confirm structure
 *
 *`const program = 'const returnTime = _ourRequire("{ID}");';`
 *`console.log("Import AST:", ast.parse(program).body[0]);`
 */
const getImport = (item, allDeps) => {
  // get function we import
  const importFunctionName = item.specifiers[0].imported.name;
  // get files full path and find index in deps array.
  const fileImported = item.source.value;
  // TODO: locally doesnt add /src/ so needs it. relates to CWD.
  const fullFile = path.resolve(fileImported.replace("./", "./src/"));
  const itemId = allDeps.findIndex(item => item.name === fullFile);

  return {
    type: "VariableDeclaration",
    kind: "const",
    declarations: [
      {
        type: "VariableDeclarator",
        init: {
          type: "CallExpression",
          callee: {
            type: "Identifier",
            name: "_ourRequire"
          },
          arguments: [
            {
              type: "Literal",
              value: itemId
            }
          ]
        },
        id: {
          type: "Identifier",
          name: importFunctionName
        }
      }
    ]
  };
};

/* Replacing ESM export with our function.
 * Use below code snippet to confirm structure
 *
 *`const program = "module.exports = someFunction;";`
 *`console.log("Import AST:", ast.parse(program).body[0]);`
 */
const getExport = item => {
  // get export functions name
  const moduleName = item.specifiers[0].exported.name;
  return {
    type: "ExpressionStatement",
    expression: {
      type: "AssignmentExpression",
      left: {
        type: "MemberExpression",
        object: { type: "Identifier", name: "module" },
        computed: false,
        property: { type: "Identifier", name: "exports" }
      },
      operator: "=",
      right: { type: "Identifier", name: moduleName }
    }
  };
};

/*
 * Take depsArray and return bundle string
 */
const transform = depsArray => {
  const modulesString = [];

  eventEmitter.emit("transform_deps", depsArray.length);
  depsArray.map(dependency => {
    const updatedAst = dependency.source.body.map(item => {
      if (item.type === "ImportDeclaration") {
        // replace module import with ours
        item = getImport(item, depsArray);
      }
      if (item.type === "ExportNamedDeclaration") {
        // replaces function name with real exported function
        item = getExport(item);
      }
      return item;
    });
    dependency.source.body = updatedAst;

    // Turn AST back into string
    const updatedSource = ast.generate(dependency.source);

    // Bind module source to module template
    const updatedTemplate = buildModuleTemplateString(updatedSource);
    modulesString.push(updatedTemplate);
  });

  // Add all modules to bundle
  const bundleString = buildRuntimeTemplateString(modulesString.join(","));

  eventEmitter.emit("return_bundle_string");
  return bundleString;
};
export { transform };
