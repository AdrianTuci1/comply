# Build from apps/api-dotnet so the Functions project is the only source of truth.
# The Azure Functions runtime image is linux/amd64 only, so the SDK stage builds natively
# ($BUILDPLATFORM) and the publish output is copied into the runtime image unchanged.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY Directory.Build.props ./
COPY src/Comply.Functions/Comply.Functions.csproj src/Comply.Functions/
RUN dotnet restore src/Comply.Functions/Comply.Functions.csproj

COPY src/Comply.Functions/ src/Comply.Functions/
RUN dotnet publish src/Comply.Functions/Comply.Functions.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/azure-functions/dotnet-isolated:4-dotnet-isolated8.0 AS runtime
ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true \
    FUNCTIONS_WORKER_RUNTIME=dotnet-isolated

COPY --from=build /app/publish /home/site/wwwroot
