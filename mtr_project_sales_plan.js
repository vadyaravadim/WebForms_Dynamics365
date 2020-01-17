function openModalBox() {
    let windowOptions = {
        height: (window.screen.height / 100) * 60,
        width: (window.screen.height / 100) * 80
    };
    Xrm.Navigation.openWebResource("mtr_project_sales_plan.html", windowOptions);
}

function activateLoader() {
    const loader = document.getElementById("backloader");
    loader.style.display = "flex";
    window.addEventListener("beforeunload", eventHandlerCloseWindow);
}

function eventHandlerCloseWindow(evt) {
    let message = "Данные в процессе сохранения. Точно закрыть страницу?";
    if (typeof evt == "undefined") {
        evt = window.event;
    }
    if (evt) {
        evt.returnValue = message;
    }
    return message;
}

function deactivateLoader() {
    const loader = document.getElementById("backloader");
    loader.style.display = "none";
    window.removeEventListener("beforeunload", eventHandlerCloseWindow);
}

// Костыль из-за неправильно функционирующего поиска
function removeAdditionsAttr() {
    let inputSearch = $('[type="search"]');
    if (inputSearch[0] != undefined && inputSearch[0] != null)
    {
        inputSearch[0].attributes.removeNamedItem("type");
    }
}

$(document).ready(() => {
    $("#submit").click(() => {
        if (dataRows().count > 0) {
            activateLoader();
            new Promise((resolve, reject) => {
                createProjectPlans(resolve, reject);
            }).then((resolve) => {
                deactivateLoader();
            });
        }
    });

    $("#mtr_building").DataTable({
        select: {
            style: "multi"
        },
        data: getBuilding(),
        columns: [
            { title: "Название" },
            { title: "Тип" },
            { title: "Id", visible: false }
        ]
    });

    removeAdditionsAttr();
});

function getBuilding() {
    let dataSet = [];
    $.ajax({
        type: "GET",
        contentType: "application/json; charset=utf-8",
        datatype: "json",
        url: `${window.location.protocol}//${window.location.host}/api/data/v9.1/mtr_buildings?$select=_owningteam_value,mtr_building_type,mtr_buildingid,mtr_name&$filter=mtr_isimplementation eq true`,
        beforeSend: function (XMLHttpRequest) {
            XMLHttpRequest.setRequestHeader("OData-MaxVersion", "4.0");
            XMLHttpRequest.setRequestHeader("OData-Version", "4.0");
            XMLHttpRequest.setRequestHeader("Accept", "application/json");
            XMLHttpRequest.setRequestHeader("Prefer", 'odata.include-annotations="*"');
        },
        async: false,
        context: this,
        success: function (data, textStatus, xhr) {
            for (let i = 0; i < xhr.responseJSON.value.length; i++) {
                let data = [];
                let valueType = xhr.responseJSON.value[i]["mtr_building_type@OData.Community.Display.V1.FormattedValue"];
                data.push(xhr.responseJSON.value[i]["mtr_name"], valueType == null ? "" : valueType, xhr.responseJSON.value[i]["mtr_buildingid"], xhr.responseJSON.value[i]["_owningteam_value"]);
                dataSet.push(data);
            }
        },
        error: function (xhr, textStatus, errorThrown)
        {
            console.error(textStatus + " " + errorThrown);
        }
    });
    return dataSet;
}

let dataRows = function() {
    let table = $("#mtr_building").DataTable();
    let rows = table.rows(".selected").select().data();
    let count = table.rows(".selected").count();
    return {
        rows: rows,
        count: count
    };
};

async function createProjectPlans(resolve, reject) {
    // Объект для создания записи План продаж на проект
    let dataRecord = {};

    for (let counter = 0; counter < dataRows().count; counter++) {
        let bildingsId = dataRows().rows[counter][2];
        dataRecord["mtr_buildingid@odata.bind"] = `/mtr_buildings(${bildingsId})`;

        let teamsId = dataRows().rows[counter][3];
        if (teamsId != null && teamsId != undefined) {
            dataRecord["ownerid@odata.bind"] = `/teams(${teamsId})`;
        }

        dataRecord.mtr_month = document.getElementById("month").value;
        dataRecord.mtr_year = document.getElementById("year").value;
        dataRecord.mtr_project_winner = 1;

        let nameBuilding = dataRows().rows[counter][0];
        let month = document.getElementById("month").selectedOptions[0].text;
        let year = document.getElementById("year").selectedOptions[0].text;
        dataRecord.mtr_name = `${nameBuilding}-${month}-${year}`;

        // Создание планов продаж на проект
        let projectSalesPlanId = await new Promise((resolve, reject) => createProjectSalesPlan(dataRecord, resolve, reject));

        // Создание планов продаж на всех менеджеров в группе ответственных выбранного застройщика
        createManagerSalesPlan(dataRecord, projectSalesPlanId);
    }
    resolve();
}

function createProjectSalesPlan(dataRecord, resolve, reject) {
    $.ajax({
        type: "POST",
        contentType: "application/json; charset=utf-8",
        datatype: "json",
        url: `${window.location.protocol}//${window.location.host}/api/data/v9.1/mtr_project_sales_plans`,
        data: JSON.stringify(dataRecord),
        beforeSend: function (XMLHttpRequest) {
            XMLHttpRequest.setRequestHeader("OData-MaxVersion", "4.0");
            XMLHttpRequest.setRequestHeader("OData-Version", "4.0");
            XMLHttpRequest.setRequestHeader("Accept", "application/json");
            XMLHttpRequest.setRequestHeader("Prefer", 'odata.include-annotations="*"');
        },
        async: true,
        success: function (data, textStatus, xhr) {
            let uri = xhr.getResponseHeader("OData-EntityId");
            let regExp = /\(([^)]+)\)/;
            let matches = regExp.exec(uri);
            let projectSalesPlanId = matches[1];
            resolve(projectSalesPlanId);
        },
        error: function (xhr, textStatus, errorThrown) {
            console.error(`${textStatus} /// ${errorThrown}`);
        }
    });
}

async function createManagerSalesPlan(dataRecordProjectPlan, projectSalesPlanId) {
    // Объект для создания записи План продаж на менеджера
    let dataRecord = {
        ["mtr_buildingid@odata.bind"]: `${dataRecordProjectPlan["mtr_buildingid@odata.bind"]}`,
        ["mtr_project_sales_plan@odata.bind"]: `/mtr_project_sales_plans(${projectSalesPlanId})`,
        mtr_month: document.getElementById("month").value,
        mtr_year: document.getElementById("year").value,
        mtr_metersplan: 0,
        mtr_rublesplan: Number(parseFloat(0).toFixed(4))
    };

    // Получаем всех пользователей в групппе ответственных застройщика
    let listMembers = await new Promise((resolve, reject) => getMemberTeam(dataRecordProjectPlan, resolve, reject));
    if (listMembers == undefined || listMembers == null) {
        return;
    }

    // Для каждого пользователя создаем план продаж
    for (let i = 0; i < listMembers.value.length; i++) {
        let systemuserid = listMembers.value[i]["systemuserid"];
        let resultObjRequestUsers = new Promise((resolve, reject) => checkUserActive(systemuserid, resolve, reject));

        resultObjRequestUsers.then(value => {
            if (Boolean(value.bool)) {
                dataRecord["mtr_managerid@odata.bind"] = `/systemusers(${systemuserid})`;
                dataRecord.mtr_name = `${dataRecordProjectPlan.mtr_name}-${value.data["fullname"]}`;
                execute();
            }
        });
    }

    function execute() {
        $.ajax({
            type: "POST",
            contentType: "application/json; charset=utf-8",
            datatype: "json",
            url: Xrm.Page.context.getClientUrl() + "/api/data/v9.1/mtr_sales_plans",
            data: JSON.stringify(dataRecord),
            beforeSend: function (XMLHttpRequest) {
                XMLHttpRequest.setRequestHeader("OData-MaxVersion", "4.0");
                XMLHttpRequest.setRequestHeader("OData-Version", "4.0");
                XMLHttpRequest.setRequestHeader("Accept", "application/json");
            },
            async: true,
            success: function (data, textStatus, xhr) { console.log("success create sales competitor"); },
            error: function (xhr, textStatus, errorThrown) {
                console.error(`${textStatus} /// ${errorThrown}`);
            }
        });
    }
}

function getMemberTeam(dataRecordProjectPlan, resolve, reject) {
    let teamId = dataRecordProjectPlan["ownerid@odata.bind"];
    if (teamId == undefined || teamId == null) {
        return;
    }

    teamId = teamId.replace("/teams(", "").replace(")", "");

    $.ajax({
        type: "GET",
        contentType: "application/json; charset=utf-8",
        datatype: "json",
        url: `${window.location.protocol}//${window.location.host}/api/data/v9.1/teammemberships?$select=systemuserid,teamid&$filter=teamid eq ${teamId}`,
        beforeSend: function (XMLHttpRequest) {
            XMLHttpRequest.setRequestHeader("OData-MaxVersion", "4.0");
            XMLHttpRequest.setRequestHeader("OData-Version", "4.0");
            XMLHttpRequest.setRequestHeader("Accept", "application/json");
            XMLHttpRequest.setRequestHeader("Prefer", 'odata.include-annotations="*"');
        },
        async: true,
        success: function (data, textStatus, xhr) {
            // Возвращаем лист всех пользователей
            resolve(data);
        },
        error: function (xhr, textStatus, errorThrown) {
            console.error(`${textStatus} /// ${errorThrown}`);
        }
    });
}

function checkUserActive(userId, resolve, reject) {
    if (userId == undefined || userId == null) {
        return;
    }

    // Возвращение результирующего объекта, который в себя включает
    // булево свойство, означающее найден ли пользователь (bool)
    // Имя пользователя (data)
    // Сообщение о результате запроса (message)

    let resultObjRequest = {};
    $.ajax({
        type: "GET",
        contentType: "application/json; charset=utf-8",
        datatype: "json",
        url: `${window.location.protocol}//${window.location.host}/api/data/v9.1/systemusers?$select=systemuserid,fullname&$filter=isdisabled eq false and  systemuserid eq ${userId}`,
        beforeSend: function (XMLHttpRequest) {
            XMLHttpRequest.setRequestHeader("OData-MaxVersion", "4.0");
            XMLHttpRequest.setRequestHeader("OData-Version", "4.0");
            XMLHttpRequest.setRequestHeader("Accept", "application/json");
            XMLHttpRequest.setRequestHeader("Prefer", 'odata.include-annotations="*"');
        },
        async: true,
        success: function (data, textStatus, xhr) {
            if (data.value.length > 0) {
                resultObjRequest.bool = data.value.length > 0;
                resultObjRequest.message = "success";
                resultObjRequest.data = data.value[0];
                resolve(resultObjRequest);
            }
            resultObjRequest.bool = data.value.length > 0;
            resultObjRequest.message = "not found";
            resolve(resultObjRequest);
        },
        error: function (xhr, textStatus, errorThrown) {
            console.error(`${textStatus} /// ${errorThrown}`);
        }
    });
}
