import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {GithubDeployRoleStack} from "../lib/github-deploy-role-stack";



function createTemplate(): Template {
    const app = new App();

    const stack = new GithubDeployRoleStack(app, 'TestGitHubRole', {
        env: {
            account: '123456789012',
            region: 'eu-west-1',
        },
        repositories: ['example/claimflow'],
        branch: 'main',
    });

    return Template.fromStack(stack);
}

describe('GitHubDeployRoleStack', () => {
    const template = createTemplate();
    it('crée un rôle IAM', () => {
        template.resourceCountIs('AWS::IAM::Role', 1);
    });

    it('limite la confiance au dépôt et à main', () => {
        const template = createTemplate();

        template.hasResourceProperties('AWS::IAM::Role', {
            AssumeRolePolicyDocument: {
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Effect: 'Allow',
                        Action: 'sts:AssumeRoleWithWebIdentity',
                        Condition: {
                            StringEquals: {
                                'token.actions.githubusercontent.com:aud':
                                    'sts.amazonaws.com',
                                'token.actions.githubusercontent.com:sub': [
                                    'repo:example/claimflow:ref:refs/heads/main',
                                ],
                            },
                        },
                    }),
                ]),
            },
        });
    });

    it('ne crée pas de permissions IAM supplémentaires', () => {
        const template = createTemplate();

        template.resourceCountIs('AWS::IAM::Policy', 0);
    });

    it('refuse une liste vide de dépôts', () => {
        const app = new App();

        expect(() => {
            new GithubDeployRoleStack(app, 'InvalidGitHubRole', {
                repositories: [],
                branch: 'main',
            });
        }).toThrow('No Repositories found.');
    });
});