import {
    CfnOutput,
    Stack,
    type StackProps,
} from 'aws-cdk-lib';

import {
    aws_iam as iam,
} from 'aws-cdk-lib';

import type { Construct } from 'constructs';

export interface GithubDeployRoleStackProps extends StackProps {
    readonly repositories: string[];
    readonly branch: string;
}

export class GithubDeployRoleStack extends Stack {
    constructor(scope: Construct, id: string, props: GithubDeployRoleStackProps) {
        super(scope, id, props);

        if(props.repositories.length === 0) {
            throw new Error('No Repositories found.');
        }

        const branchMatch =/^[A-Za-z0-9._/-]+$/.test(props.branch)

        if(!branchMatch) {
            throw new Error('No Repositories found.');
        }

        for(const repo of props.repositories) {
            const repoNameMatch = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)
            if(!repoNameMatch) {
                throw new Error(`Repository ${repo} not found.`);
            }
        }

        const providerArn = `arn:${Stack.of(this).partition}:iam::${Stack.of(this).account}:oidc-provider/token.actions.githubusercontent.com`;

        const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
            this,
            "GithubOidcProvider",
            providerArn,
        )

        const subjects = props.repositories.map(
            (repository) => `repo:${repository}:ref:refs/heads/${props.branch}`
        )

        const principal = new iam.OpenIdConnectPrincipal(
            provider,
            {
                StringEquals: {
                    'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                    'token.actions.githubusercontent.com:sub': subjects,
                },
            },
        );

        const role = new iam.Role(this, 'GitHubDeploymentRole', {
            roleName: 'github-express-template-deployer',
            description: 'GitHub Actions OIDC deployment identity',
            assumedBy: principal,
            maxSessionDuration: undefined,
        });

        // IMPORTANT :
        // This role only has a trust an OIDC trust relationship.
        // We are not yet assigning AWS deployment permission to it
      new CfnOutput(this, 'GitHubRoleArn', {
          value: role.roleArn,
          description:'ARN du rôle GitHub Actions'
      })

    }
}