import {App} from "aws-cdk-lib";
import * as console from "node:console";
import {ApiServiceStack} from "../lib/api-service-stack.js";
import {GithubDeployRoleStack} from "../lib/github-deploy-role-stack.js";


const context = 'githubRepos';
const app = new App()

new ApiServiceStack(app, "ExpressTemplateStack", {
    appName: 'express-template',
    dockerContext:'..',
    containerPort:3000,
    appSecretArn:'arn:aws:secretsmanager:<region>:<compte>:secret:express-template/app-XXXXXX',
    withDatabase:false,
    withRedis:false,
})

const githubRepos:unknown = app.node.tryGetContext(context);
// Debug diag
console.log("Github context", githubRepos)

if(typeof githubRepos === 'string' && githubRepos.trim() != ''){
    const repository = githubRepos
        .split(',')
        .map((repo) => repo.trim())
        .filter(Boolean)

    console.log("Creating GithubDeployRoleStack", repository)

    new GithubDeployRoleStack(app, 'GithubDeployRoleStack', {
        repositories: repository,
        branch: 'main',
    })
}