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
        postConfirmationLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["cognito-idp:AdminAddUserToGroup"],
                resources: ["*"],
            })
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

        const writerGroup = new cognito.CfnUserPoolGroup(this, "writerGroup", {
            userPoolId: userPool.userPoolId,
            groupName: "writer",
            precedence: 1,
        });

        const readerGroup = new cognito.CfnUserPoolGroup(this, "readerGroup", {
            userPoolId: userPool.userPoolId,
            groupName: "reader",
            precedence: 2,
        });

        const client = userPool.addClient("demo-client");

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
        userGroupBased.addMethod(
            "GET",
            new apigateway.LambdaIntegration(readLambda)
        );
        userGroupBased.addMethod(
            "POST",
            new apigateway.LambdaIntegration(writeLambda)
        );

        // CFN OUTPUTS

        new CfnOutput(this, "cognito-user-pool-id", {
            value: userPool.userPoolId,
            description: "Cognito User userPool Id",
        });

        new CfnOutput(this, "cognito-user-pool-client-id", {
            value: client.userPoolClientId,
            description: "Cognito User userPool Client Id",
        });

        new CfnOutput(this, "api", {
            value: api.url,
            description: "API URL",
        });
    }
}

module.exports = { CognitoDemoCdkStack };
