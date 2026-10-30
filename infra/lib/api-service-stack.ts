import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    type StackProps,
} from 'aws-cdk-lib';

import {
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecsPatterns,
    aws_logs as logs,
} from 'aws-cdk-lib';

import type { Construct } from 'constructs';


export interface ApiServiceStackProps extends StackProps {
    readonly appName: string;
    readonly dockerContext:string
    readonly containerPort: number
    readonly withDatabase:boolean
    readonly withRedis:boolean
}

export class ApiServiceStack extends Stack {
    constructor(
        scope: Construct,
        id: string,
        props: ApiServiceStackProps) {
        super(scope, id, props);

        if(props.withDatabase || props.withRedis) {
            const errorMessage = 'withDatabase et withRedis are not implemented.'
            console.log(errorMessage)
            throw new Error(errorMessage)
        }

        if(
            !Number.isInteger(props.containerPort) ||
            props.containerPort < 1 ||
            props.containerPort > 65535
        ) {
            throw new Error("ContainerPort must be a valid TCP port.")
        }

        //Find dockerfile from this location
        const currentDir = path.dirname(fileURLToPath(import.meta.url))

        const dockerDirectory = path.resolve(
            currentDir,
            '..',
            props.dockerContext
        )

        // serviceName
        const serviceName = props.appName

        // Create a VPC
        const vpc = this.createVpc()

        // 3. Create a ECS cluster.
        const cluster = new ecs.Cluster(this,'Cluster',{
            vpc,
            clusterName:`${serviceName}-cluster`,
            containerInsightsV2: ecs.ContainerInsights.DISABLED,
        })

        // 4. Configure log conservation.
        const logGroup = new logs.LogGroup(this, 'LogGroup', {
            logGroupName:`ecs/${serviceName}`,
            retention:logs.RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
        })

        // 5. Build Docker image from this repo.
        const image = ecs.ContainerImage.fromAsset(dockerDirectory)

        // 6. Create service ECS Fargate with a ALB.
        const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
            this,
            "ApiService",
            {
                cluster,
                serviceName:`${serviceName}-service`,

                cpu: 256,
                memoryLimitMiB:512,
                desiredCount:1,

                publicLoadBalancer:true,
                assignPublicIp:true,

                taskSubnets:{
                    subnetType: ec2.SubnetType.PUBLIC,
                },

                listenerPort:80,

                taskImageOptions:{
                    image,
                    containerName:`${serviceName}-container`,

                    environment:{
                        NODE_ENV:'production',
                        PORT: String(props.containerPort),
                        LOG_LEVEL:'info'
                    },

                    logDriver: ecs.LogDriver.awsLogs({
                        streamPrefix:serviceName,
                        logGroup,
                    })
                }

            }
        )

        // 7. Configure application  health check.
        service.targetGroup.configureHealthCheck({
            path:'/heath',
            healthyGrpcCodes:'200',
            interval:Duration.seconds(30),
            healthyThresholdCount:2,
            unhealthyThresholdCount:3,
        })

        // 8. Produce app URL after deployment.
        const appFinalURL = service.loadBalancer.loadBalancerDnsName
        new CfnOutput(this,'ApiUrl', {
            value : `http://${appFinalURL}`,
            description:'Express api HTTP URL',
        })

        new CfnOutput(this,'HearthUrl', {
            value:`http://${appFinalURL}/health`,
            description:'Express api health verification URL',
        })
        new CfnOutput(this,'ClusterName', {
            value: cluster.clusterName,
            description:'Express api cluster name',
        })
    }

    private createVpc(){
        return new ec2.Vpc(this, 'Vpc', {
            maxAzs:2,
            natGateways:0,
            subnetConfiguration:[
                {
                    name:'Public',
                    subnetType:ec2.SubnetType.PUBLIC,
                    cidrMask:24
                }
            ]
        })
    }

}