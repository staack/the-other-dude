{{/*
Expand the name of the chart.
*/}}
{{- define "tod.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name (truncated to 63 chars for DNS compliance).
*/}}
{{- define "tod.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version for the chart label.
*/}}
{{- define "tod.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "tod.labels" -}}
helm.sh/chart: {{ include "tod.chart" . }}
{{ include "tod.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (used in Deployments/Services to match pods).
*/}}
{{- define "tod.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tod.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Component labels — call with: include "tod.componentLabels" (dict "context" . "component" "api")
*/}}
{{- define "tod.componentLabels" -}}
{{ include "tod.labels" .context }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Component selector labels — call with: include "tod.componentSelectorLabels" (dict "context" . "component" "api")
*/}}
{{- define "tod.componentSelectorLabels" -}}
{{ include "tod.selectorLabels" .context }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Database URL (superuser, async — used by API for runtime queries).
*/}}
{{- define "tod.databaseUrl" -}}
{{- if .Values.postgres.enabled }}
{{- printf "postgresql+asyncpg://%s:%s@%s-postgres:%d/%s" .Values.postgres.auth.username .Values.secrets.dbPassword (include "tod.fullname" .) (int .Values.postgres.service.port) .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.externalUrl }}
{{- end }}
{{- end }}

{{/*
Database URL (superuser, sync — for Alembic migrations).
*/}}
{{- define "tod.syncDatabaseUrl" -}}
{{- if .Values.postgres.enabled }}
{{- printf "postgresql+psycopg2://%s:%s@%s-postgres:%d/%s" .Values.postgres.auth.username .Values.secrets.dbPassword (include "tod.fullname" .) (int .Values.postgres.service.port) .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.externalUrl | replace "asyncpg" "psycopg2" }}
{{- end }}
{{- end }}

{{/*
Database URL (app_user, RLS-enforced — used by API for tenant-scoped queries).
*/}}
{{- define "tod.appUserDatabaseUrl" -}}
{{- if .Values.postgres.enabled }}
{{- printf "postgresql+asyncpg://%s:%s@%s-postgres:%d/%s" .Values.postgres.auth.appUsername .Values.secrets.dbAppPassword (include "tod.fullname" .) (int .Values.postgres.service.port) .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.externalUrl }}
{{- end }}
{{- end }}

{{/*
Database URL (poller_user, bypasses RLS — uses postgres:// not postgresql+asyncpg://).
*/}}
{{- define "tod.pollerDatabaseUrl" -}}
{{- if .Values.postgres.enabled }}
{{- printf "postgres://poller_user:%s@%s-postgres:%d/%s" .Values.secrets.dbPollerPassword (include "tod.fullname" .) (int .Values.postgres.service.port) .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.externalPollerUrl | default .Values.postgres.externalUrl }}
{{- end }}
{{- end }}

{{/*
Redis URL.
*/}}
{{- define "tod.redisUrl" -}}
{{- if .Values.redis.enabled }}
{{- printf "redis://%s-redis:%d/0" (include "tod.fullname" .) (int .Values.redis.service.port) }}
{{- else }}
{{- .Values.redis.externalUrl | default "redis://localhost:6379/0" }}
{{- end }}
{{- end }}

{{/*
NATS URL.
*/}}
{{- define "tod.natsUrl" -}}
{{- if .Values.nats.enabled }}
{{- printf "nats://%s-nats:%d" (include "tod.fullname" .) (int .Values.nats.service.port) }}
{{- else }}
{{- .Values.nats.externalUrl | default "nats://localhost:4222" }}
{{- end }}
{{- end }}

{{/*
OpenBao address.
*/}}
{{- define "tod.openbaoAddr" -}}
{{- if .Values.openbao.enabled }}
{{- printf "http://%s-openbao:%d" (include "tod.fullname" .) 8200 }}
{{- else }}
{{- .Values.openbao.externalAddr | default "http://localhost:8200" }}
{{- end }}
{{- end }}
