const {
    Projects,
} = require('../models/models');

const isRequestTrusted = req => {
    if (process.argv.includes('--alwaysTrusted')) return true
    // This indicates the request comes from within the cluster so we trust it and no auth is needed
    return (
        (process.env.K8S_NAMESPACE && process.env.K8S_NAMESPACE.matches(req.hostname)) ||
        req.hostname === 'localhost'
    );
};

const addKeyToQuery = (q, req) => {
    const { query: { key: apiKey = null } = {} } = req;
    if (apiKey && !isRequestTrusted(req)) Object.assign(q, { apiKey });
    return q;
};

/**
 * Finds the project corresponding to the API key provided in req
 * (if request is not coming from a trusted place)
 */
const getVerifiedProject = function (projectId, req, projection) {
    const selection = projection ? { _id: 1, ...projection } : null;
    return Projects.findOne(addKeyToQuery({ _id: projectId }, req), selection).lean();
};

exports.uploadFileToGcs = (filePath, bucket, env = 'development') => {
    const { Storage } = require('@google-cloud/storage');
    const storage = new Storage();
    const filename = filePath.replace(/^.*[\/]/, '') //replace eveything between slashes by '' so we get the filename
    try {
        return storage.bucket(bucket).upload(`${filePath}`, { destination: `${env}/${filename}` });
    }
    catch (e) {
        console.log(e)
    }
}

exports.uploadModelToGcs = async (filePath, bucket) => {
    try {
        const { Storage } = require('@google-cloud/storage');
        const storage = new Storage();
        const filename = filePath.replace(/^.*[\/]/, '') //replace eveything between slashes by '' so we get the filename
        await storage.bucket(bucket).upload(`${filePath}`, {
            destination: filename,
            metadata: {
                cacheControl: 'public, max-age=0',
            },
        });
    }
    catch (e) {
        console.log(e)
        throw new Error('failed while uploading the model on google cloud storage')
    }
}

exports.deleteFileFromGcs = async (filePath, bucket) => {
    const decodedUri = decodeURIComponent(filePath)
    const { Storage } = require('@google-cloud/storage');
    const storage = new Storage();
    try {
        return storage.bucket(bucket).file(decodedUri).delete();
    }
    catch (e) {
        console.log(e)
        throw new Error('failed while deleting a file on google cloud storage')
    }
}


exports.copyFilesGcs = async (bucket, source, destination) => {
    const { Storage } = require('@google-cloud/storage');
    const storage = new Storage();
    try {
        const [files] = await storage.bucket(bucket).getFiles({ prefix: source })
        const copyPromises = files.map(async (file) => { await file.copy(file.name.replace(source, destination)) })
        return Promise.all(copyPromises)
    }
    catch (e) {
        console.log(e)
        throw new Error('failed while duplicating files on google cloud storage')
    }
}



exports.getImagesBucket = async (projectId, req) => {
    const project = await getVerifiedProject(projectId, req);
    if (!project) return { error: 'unauthorized', status: 401 };
    const { CLUSTER_ENVIRONMENT, GCP_PROJECT_ID } = process.env;
    if (!project.namespace)
        return { error: 'No GC namespace set for project', status: 422 };
    if (!CLUSTER_ENVIRONMENT)
        return { error: 'No CLUSTER_ENVIRONMENT variable set', status: 422 };
    if (!GCP_PROJECT_ID) return { error: 'No GCP_PROJECT_ID variable set', status: 422 };
    return {
        bucket: `${CLUSTER_ENVIRONMENT}-media-${project.namespace}-${GCP_PROJECT_ID}`,
    };
};


exports.getModelsBucket = async (projectId, req) => {
    const project = await getVerifiedProject(projectId, req);
    if (!project) return { error: 'unauthorized', status: 401 };
    const { CLUSTER_ENVIRONMENT, GCP_PROJECT_ID } = process.env;
    if (!project.namespace)
        return { error: 'No GC namespace set for project', status: 422 };
    if (!CLUSTER_ENVIRONMENT)
        return { error: 'No CLUSTER_ENVIRONMENT variable set', status: 422 };
    if (!GCP_PROJECT_ID) return { error: 'No GCP_PROJECT_ID variable set', status: 422 };
    return {
        bucket: `${CLUSTER_ENVIRONMENT}-models-${project.namespace}-${GCP_PROJECT_ID}`,
    };
};


const isTimestampLessRecent = (filename, latest) => {
    const extractTimeStampRegex = /(?<=(-))[0-9]+/
    const latestTs = latest.match(extractTimeStampRegex)[0]
    const fileTs = filename.match(extractTimeStampRegex)[0]
    return latestTs > fileTs
}

exports.removeFilesOfEnvExceptLatest = async (bucket, environement, latest) => {
    const { Storage } = require('@google-cloud/storage');
    const storage = new Storage();
    try {
        const [files] = await storage.bucket(bucket).getFiles({ prefix: environement })
        const toDelete = files.filter((file) => (!file.name.includes(latest) && isTimestampLessRecent(file.name, latest)))
        const deletePromises = toDelete.map(async (file) => { await file.delete() })
        return Promise.all(deletePromises)
    }
    catch (e) {
        console.log(e)
        throw new Error('failed while deleting files on google cloud storage')
    }

}