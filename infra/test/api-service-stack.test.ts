import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {ApiServiceStack} from "../lib/api-service-stack";



const testDir = path.dirname(fileURLToPath(import.meta.url));

const dockerContext = path.resolve(testDir, '../..');

function createTemplate(): Template {
    const app = new App();

    const stack = new ApiServiceStack(app, 'TestApiStack', {
        appName: 'test-api',
        dockerContext,
        containerPort: 3000,
        appSecretArn: 'arn:aws:secretsmanager:eu-west-3:123456789012:secret:test-api/app-AbCdEf',
        withDatabase: false,
        withRedis: false,
    });

    return Template.fromStack(stack);
}

describe('ApiServiceStack', () => {
    const template = createTemplate();

    it('crée un VPC', () => {
        template.resourceCountIs('AWS::EC2::VPC', 1);
    });

    it('crée un cluster ECS', () => {
        template.resourceCountIs('AWS::ECS::Cluster', 1);
    });

    it('crée un service ECS Fargate', () => {
        const template = createTemplate();

        template.hasResourceProperties('AWS::ECS::Service', {
            DesiredCount: 1,
            LaunchType: 'FARGATE',
        });
    });

    it('configure CPU et mémoire', () => {
        const template = createTemplate();

        template.hasResourceProperties('AWS::ECS::TaskDefinition', {
            Cpu: '256',
            Memory: '512',
            NetworkMode: 'awsvpc',
            RequiresCompatibilities: Match.arrayWith(['FARGATE']),
        });
    });

    it('crée un Application Load Balancer', () => {
        const template = createTemplate();

        template.hasResourceProperties(
            'AWS::ElasticLoadBalancingV2::LoadBalancer',
            {
                Type: 'application',
                Scheme: 'internet-facing',
            },
        );
    });

    it('vérifie la santé sur /health', () => {
        const template = createTemplate();

        template.hasResourceProperties(
            'AWS::ElasticLoadBalancingV2::TargetGroup',
            {
                HealthCheckPath: '/health',
                Matcher: {
                    HttpCode: '200',
                },
            },
        );
    });

    it('ne crée pas de NAT Gateway', () => {
        const template = createTemplate();

        template.resourceCountIs('AWS::EC2::NatGateway', 0);
    });

    it('refuse les services optionnels non implémentés', () => {
        const app = new App();

        expect(() => {
            new ApiServiceStack(app, 'UnsupportedStack', {
                appName: 'test-api',
                dockerContext,
                containerPort: 3000,
                appSecretArn: 'arn:aws:secretsmanager:eu-west-3:123456789012:secret:test-api/app-AbCdEf',
                withDatabase: true,
                withRedis: false,
            });
        }).toThrow(/are not implemented/i);
    });
});