const { Stack, CfnOutput } = require("aws-cdk-lib");
const cognito = require("aws-cdk-lib/aws-cognito");
const lambda = require("aws-cdk-lib/aws-lambda");
const iam = require("aws-cdk-lib/aws-iam");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const path = require("path");

class CognitoDemoCdkStack extends Stack {
    /**
     *
     * @param scope
     * @param id
     * @param props
     */
    constructor(scope, id, props) {
        super(scope, id, props);

        // LAMBDA FUNCTIONS

        const readLambda = new lambda.Function(this, "read", {
            code: lambda.Code.fromAsset(path.join(__dirname, "../lambdas")),
            runtime: lambda.Runtime.NODEJS_16_X,
            handler: "index.read",
        });

        const writeLambda = new lambda.Function(this, "write", {
            code: lambda.Code.fromAsset(path.join(__dirname, "../lambdas")),
            runtime: lambda.Runtime.NODEJS_16_X,
            handler: "index.write",
        });

        const postConfirmationLambda = new lambda.Function(
            this,
            "postConfirmation",
            {
                code: lambda.Code.fromAsset(path.join(__dirname, "../lambdas")),
                runtime: lambda.Runtime.NODEJS_16_X,
                handler: "index.addUserToReaderGroup",
            }
        );

        // COGNITO USER POOL

        const userPool = new cognito.UserPool(this, "demo-userpool", {
            userPoolName: "demo-userpool",
            selfSignUpEnabled: true,
            signInAliases: {
                email: true,
            },
            mfa: cognito.Mfa.REQUIRED,
            mfaSecondFactor: {
                sms: false,
                otp: true,
            },
        });
        userPool.addTrigger(
            cognito.UserPoolOperation.POST_CONFIRMATION,
            postConfirmationLambda
        );
        const userPoolClient = userPool.addClient("demo-client");

        // https://bobbyhadz.com/blog/aws-cdk-cognito-identity-pool-example
        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cognito-identitypool-alpha-readme.html#authentication-providers
        // https://aws.amazon.com/blogs/mobile/building-fine-grained-authorization-using-amazon-cognito-user-pools-groups/
        const identityPool = new cognito.CfnIdentityPool(
            this,
            "identity-pool",
            {
                identityPoolName: "my-identity-pool",
                allowUnauthenticatedIdentities: false,
                cognitoIdentityProviders: [
                    {
                        clientId: userPoolClient.userPoolClientId,
                        providerName: userPool.userPoolProviderName,
                    },
                ],
            }
        );

        const readRole = new iam.Role(this, "read-role", {
            assumedBy: new iam.FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                {
                    StringEquals: {
                        "cognito-identity.amazonaws.com:aud": identityPool.ref,
                    },
                    "ForAnyValue:StringLike": {
                        "cognito-identity.amazonaws.com:amr": "authenticated",
                    },
                },
                "sts:AssumeRoleWithWebIdentity"
            ),
        });
        const readerGroup = new cognito.CfnUserPoolGroup(this, "readerGroup", {
            userPoolId: userPool.userPoolId,
            groupName: "reader",
            precedence: 2,
            roleArn: readRole.roleArn,
        });

        const writeRole = new iam.Role(this, "write-role", {
            assumedBy: new iam.FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                {
                    StringEquals: {
                        "cognito-identity.amazonaws.com:aud": identityPool.ref,
                    },
                    "ForAnyValue:StringLike": {
                        "cognito-identity.amazonaws.com:amr": "authenticated",
                    },
                },
                "sts:AssumeRoleWithWebIdentity"
            ),
        });
        const writerGroup = new cognito.CfnUserPoolGroup(this, "writerGroup", {
            userPoolId: userPool.userPoolId,
            groupName: "writer",
            precedence: 1,
            roleArn: writeRole.roleArn,
        });

        new cognito.CfnIdentityPoolRoleAttachment(
            this,
            "identity-pool-role-attachment",
            {
                identityPoolId: identityPool.ref,
                roles: {},
                roleMappings: {
                    mapping: {
                        type: "Token",
                        ambiguousRoleResolution: "Deny",
                        identityProvider: `cognito-idp.${
                            Stack.of(this).region
                        }.amazonaws.com/${userPool.userPoolId}:${
                            userPoolClient.userPoolClientId
                        }`,
                    },
                },
            }
        );

        // API GATEWAY

        const api = new apigateway.RestApi(this, "myapi", {
            // https://bobbyhadz.com/blog/add-cors-api-aws-cdk
            // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway-readme.html#cross-origin-resource-sharing-cors
            defaultCorsPreflightOptions: {
                allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
                allowCredentials: true,
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
            },
        });
        api.root.addMethod("GET", new apigateway.LambdaIntegration(readLambda));

        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway-readme.html#cognito-user-pools-authorizer
        // https://bobbyhadz.com/blog/aws-cdk-api-authorizer
        const userPoolAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
            this,
            "user-pool-authorizer",
            {
                cognitoUserPools: [userPool],
            }
        );
        const userPoolBased = api.root.addResource("user-pool-based");
        userPoolBased.addMethod(
            "GET",
            new apigateway.LambdaIntegration(readLambda),
            { authorizer: userPoolAuthorizer }
        );

        const userGroupBased = api.root.addResource("user-group-based");
        const userGroupBasedReadMethod = userGroupBased.addMethod(
            "GET",
            new apigateway.LambdaIntegration(readLambda),
            { authorizationType: apigateway.AuthorizationType.IAM }
        );

        const userGroupBasedWriteMethod = userGroupBased.addMethod(
            "POST",
            new apigateway.LambdaIntegration(writeLambda),
            { authorizationType: apigateway.AuthorizationType.IAM }
        );
        // IAM

        postConfirmationLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["cognito-idp:AdminAddUserToGroup"],
                resources: ["*"],
            })
        );

        readRole.attachInlinePolicy(
            new iam.Policy(this, "AllowRead", {
                statements: [
                    new iam.PolicyStatement({
                        actions: ["execute-api:Invoke"],
                        effect: iam.Effect.ALLOW,
                        resources: [userGroupBasedReadMethod.methodArn],
                    }),
                ],
            })
        );

        writeRole.attachInlinePolicy(
            new iam.Policy(this, "AllowWrite", {
                statements: [
                    new iam.PolicyStatement({
                        actions: ["execute-api:Invoke"],
                        effect: iam.Effect.ALLOW,
                        resources: [userGroupBasedWriteMethod.methodArn],
                    }),
                ],
            })
        );

        // CFN OUTPUTS

        new CfnOutput(this, "cognito-user-pool-id", {
            value: userPool.userPoolId,
            description: "Cognito User userPool Id",
        });

        new CfnOutput(this, "cognito-user-pool-client-id", {
            value: userPoolClient.userPoolClientId,
            description: "Cognito User userPool Client Id",
        });

        new CfnOutput(this, "cognito-identity-pool-id", {
            value: identityPool.ref,
            description: "Cognito Identity Pool Id",
        });

        new CfnOutput(this, "api", {
            value: api.url,
            description: "API URL",
        });
    }
}

module.exports = { CognitoDemoCdkStack };
